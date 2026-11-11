import React, { useMemo, useState } from 'react';
import {
  Play,
  Shuffle,
  Search,
  Plus,
  ListPlus,
  Disc3,
  Folder,
  ArrowLeft,
  Trash2,
  ListMusic,
  Sparkles,
  Volume2,
} from 'lucide-react';
import type { Album, Playlist, Track } from '../types/music';
import type { NavTab } from './Sidebar';
import { usePlayerStore } from '../store/playerStore';
import {
  formatDuration,
  formatFileSize,
  formatSampleRate,
  formatSignalBadge,
} from '../utils/formatters';
import { db } from '../db/libraryDb';

interface LibraryViewsProps {
  activeTab: NavTab;
  tracks: Track[];
  albums: Album[];
  playlists: Playlist[];
  coverMap: Map<string, string>;
  selectedAlbumId: string | null;
  onSelectAlbumId: (albumId: string | null) => void;
}

export const LibraryViews: React.FC<LibraryViewsProps> = ({
  activeTab,
  tracks,
  albums,
  playlists,
  coverMap,
  selectedAlbumId,
  onSelectAlbumId,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [qualityFilter, setQualityFilter] = useState<'all' | 'hires' | 'flac'>('all');
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [playlistMenuTrackId, setPlaylistMenuTrackId] = useState<string | null>(null);

  const {
    currentTrack,
    status,
    playTrackList,
    playNextInQueue,
    addToQueue,
    togglePlayPause,
  } = usePlayerStore();

  const filteredTracks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tracks.filter((t) => {
      if (qualityFilter === 'hires') {
        const isHiRes = t.isLossless && ((t.bitsPerSample || 16) > 16 || (t.sampleRate || 44100) > 48000);
        if (!isHiRes) return false;
      } else if (qualityFilter === 'flac' && t.format !== 'FLAC') {
        return false;
      }

      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q) ||
        t.folderPath.toLowerCase().includes(q)
      );
    });
  }, [tracks, searchQuery, qualityFilter]);

  const filteredAlbums = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return albums.filter((a) => {
      if (qualityFilter === 'hires') {
        const isHiRes =
          a.isLossless && ((a.maxBitsPerSample || 16) > 16 || (a.maxSampleRate || 44100) > 48000);
        if (!isHiRes) return false;
      } else if (qualityFilter === 'flac' && a.format !== 'FLAC') {
        return false;
      }
      if (!q) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        a.artist.toLowerCase().includes(q) ||
        a.folderPath.toLowerCase().includes(q)
      );
    });
  }, [albums, searchQuery, qualityFilter]);

  const selectedAlbum = useMemo(
    () => albums.find((a) => a.id === selectedAlbumId) || null,
    [albums, selectedAlbumId]
  );

  const selectedAlbumTracks = useMemo(() => {
    if (!selectedAlbumId) return [];
    return tracks
      .filter((t) => t.albumId === selectedAlbumId)
      .sort((a, b) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber);
  }, [tracks, selectedAlbumId]);

  const artistsSummary = useMemo(() => {
    const map = new Map<
      string,
      { name: string; albums: Set<string>; tracks: Track[]; sampleCover?: string }
    >();
    for (const t of filteredTracks) {
      const key = t.albumArtist || t.artist || 'Unknown Artist';
      let entry = map.get(key);
      if (!entry) {
        entry = {
          name: key,
          albums: new Set(),
          tracks: [],
          sampleCover: coverMap.get(t.albumId) || t.demoCoverUrl,
        };
        map.set(key, entry);
      }
      entry.albums.add(t.albumId);
      entry.tracks.push(t);
      if (!entry.sampleCover) {
        entry.sampleCover = coverMap.get(t.albumId) || t.demoCoverUrl;
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredTracks, coverMap]);

  const folderGroups = useMemo(() => {
    const map = new Map<string, Track[]>();
    for (const t of filteredTracks) {
      const folder = t.folderPath || 'Root';
      const list = map.get(folder) || [];
      list.push(t);
      map.set(folder, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredTracks]);

  const handleCreatePlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newPlaylistName.trim();
    if (!name) return;
    await db.playlists.put({
      id: `pl-${Date.now()}`,
      name,
      trackIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    setNewPlaylistName('');
  };

  const handleAddTrackToPlaylist = async (playlist: Playlist, trackId: string) => {
    if (!playlist.trackIds.includes(trackId)) {
      await db.playlists.put({
        ...playlist,
        trackIds: [...playlist.trackIds, trackId],
        updatedAt: Date.now(),
      });
    }
    setPlaylistMenuTrackId(null);
  };

  const handleDeletePlaylist = async (id: string) => {
    await db.playlists.delete(id);
  };

  const renderTrackRow = (track: Track, idx: number, contextList: Track[]) => {
    const isPlayingThis = currentTrack?.id === track.id;
    const badge = formatSignalBadge(track);

    return (
      <div
        key={track.id}
        className={`group flex items-center justify-between px-4 py-2.5 rounded-xl text-sm transition-colors ${
          isPlayingThis
            ? 'bg-amber-500/15 text-amber-200 border border-amber-500/30'
            : 'hover:bg-zinc-900/80 text-zinc-200 border border-transparent'
        }`}
      >
        <div
          onClick={() => {
            if (isPlayingThis) {
              togglePlayPause();
            } else {
              playTrackList(contextList, idx);
            }
          }}
          className="flex items-center gap-4 min-w-0 flex-1 cursor-pointer"
        >
          <div className="w-7 text-center font-mono text-xs text-zinc-500 shrink-0">
            {isPlayingThis && status === 'playing' ? (
              <Volume2 className="w-4 h-4 text-amber-400 mx-auto animate-pulse" />
            ) : (
              <span>{track.trackNumber || idx + 1}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium truncate">{track.title}</div>
            <div className="text-xs text-zinc-400 truncate">
              {track.artist} • <span className="text-zinc-500">{track.album}</span>
            </div>
          </div>
        </div>

        {/* Lossless Spec Pill */}
        <div className="hidden md:flex items-center gap-3 px-4 shrink-0">
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
              badge.tier === 'hires'
                ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                : 'bg-zinc-900 text-zinc-400 border-zinc-800'
            }`}
          >
            {track.format} {track.bitsPerSample || 16}/{formatSampleRate(track.sampleRate)}
          </span>
          {track.size > 0 && (
            <span className="text-xs font-mono text-zinc-500 w-16 text-right">
              {formatFileSize(track.size)}
            </span>
          )}
        </div>

        {/* Quick Queue Actions & Duration */}
        <div className="flex items-center gap-2 shrink-0 relative">
          <button
            onClick={() => playNextInQueue(track)}
            title="Play Next"
            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-opacity cursor-pointer"
          >
            <ListPlus className="w-4 h-4" />
          </button>
          <button
            onClick={() => addToQueue(track)}
            title="Add to End of Queue"
            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-opacity cursor-pointer"
          >
            <Plus className="w-4 h-4" />
          </button>
          {playlists.length > 0 && (
            <div className="relative">
              <button
                onClick={() =>
                  setPlaylistMenuTrackId((curr) => (curr === track.id ? null : track.id))
                }
                title="Add to Playlist"
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-amber-300 transition-opacity cursor-pointer"
              >
                <ListMusic className="w-4 h-4" />
              </button>
              {playlistMenuTrackId === track.id && (
                <div className="absolute right-0 top-8 z-30 w-48 py-1.5 rounded-xl bg-zinc-900 border border-zinc-700 shadow-xl text-xs">
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase text-zinc-500">
                    Add to Playlist
                  </div>
                  {playlists.map((pl) => (
                    <button
                      key={pl.id}
                      onClick={() => handleAddTrackToPlaylist(pl, track.id)}
                      className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 text-zinc-200 truncate cursor-pointer"
                    >
                      {pl.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <span className="w-12 text-right font-mono text-xs text-zinc-400">
            {formatDuration(track.duration)}
          </span>
        </div>
      </div>
    );
  };

  return (
    <main className="flex-1 flex flex-col min-w-0 bg-zinc-950 overflow-hidden">
      {/* Top Search & Lossless Filter Header */}
      <header className="h-16 shrink-0 border-b border-zinc-900 px-8 flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search lossless tracks, albums, artists, or folders..."
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-zinc-900/90 border border-zinc-800 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500/50"
          />
        </div>

        <div className="flex items-center gap-2">
          {(['all', 'hires', 'flac'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setQualityFilter(filter)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                qualityFilter === filter
                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
                  : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-zinc-200'
              }`}
            >
              {filter === 'all'
                ? 'All Formats'
                : filter === 'hires'
                ? 'Hi-Res 24-Bit'
                : 'FLAC Only'}
            </button>
          ))}
        </div>
      </header>

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto p-8">
        {/* Album Detail View */}
        {activeTab === 'albums' && selectedAlbum ? (
          <div className="max-w-5xl mx-auto space-y-8">
            <button
              onClick={() => onSelectAlbumId(null)}
              className="inline-flex items-center gap-2 text-xs font-medium text-zinc-400 hover:text-zinc-100 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Albums
            </button>

            <div className="flex flex-col md:flex-row items-start md:items-end gap-7">
              <div className="w-52 h-52 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl overflow-hidden shrink-0">
                {coverMap.get(selectedAlbum.id) || selectedAlbum.demoCoverUrl ? (
                  <img
                    src={coverMap.get(selectedAlbum.id) || selectedAlbum.demoCoverUrl}
                    alt={selectedAlbum.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-600">
                    <Disc3 className="w-16 h-16" />
                  </div>
                )}
              </div>

              <div className="space-y-3 flex-1">
                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-mono">
                  <Sparkles className="w-3.5 h-3.5" />
                  {selectedAlbum.format} • {selectedAlbum.maxBitsPerSample || 16}-bit /{' '}
                  {formatSampleRate(selectedAlbum.maxSampleRate)}
                </div>
                <h1 className="text-3xl font-bold tracking-tight text-zinc-100">
                  {selectedAlbum.title}
                </h1>
                <p className="text-base text-zinc-300 font-medium">
                  {selectedAlbum.artist}
                  {selectedAlbum.year ? (
                    <span className="text-zinc-500"> • {selectedAlbum.year}</span>
                  ) : null}
                  <span className="text-zinc-500">
                    {' '}
                    • {selectedAlbumTracks.length} tracks (
                    {formatDuration(selectedAlbum.totalDuration)})
                  </span>
                </p>
                <p className="text-xs font-mono text-zinc-500">
                  Drive Path: {selectedAlbum.folderPath}
                </p>

                <div className="pt-2 flex items-center gap-3">
                  <button
                    onClick={() => playTrackList(selectedAlbumTracks, 0)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm shadow-lg shadow-amber-500/20 cursor-pointer"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    Play Album (Gapless)
                  </button>
                  <button
                    onClick={() => {
                      usePlayerStore.setState({ shuffle: true });
                      playTrackList(selectedAlbumTracks, 0);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 text-sm font-medium cursor-pointer"
                  >
                    <Shuffle className="w-4 h-4" />
                    Shuffle
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-1 pt-4 border-t border-zinc-900">
              {selectedAlbumTracks.map((track, idx) =>
                renderTrackRow(track, idx, selectedAlbumTracks)
              )}
            </div>
          </div>
        ) : null}

        {/* Albums Grid View */}
        {activeTab === 'albums' && !selectedAlbum && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-zinc-100">Lossless Albums</h2>
                <p className="text-xs text-zinc-400">
                  {filteredAlbums.length} albums indexed with instant IndexedDB metadata cache
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
              {filteredAlbums.map((album) => {
                const cover = coverMap.get(album.id) || album.demoCoverUrl;
                const isHiRes =
                  (album.maxBitsPerSample || 16) > 16 || (album.maxSampleRate || 44100) > 48000;
                return (
                  <div
                    key={album.id}
                    onClick={() => onSelectAlbumId(album.id)}
                    className="group rounded-2xl bg-zinc-900/40 hover:bg-zinc-900/90 border border-zinc-800/60 hover:border-zinc-700/80 p-3.5 transition-all cursor-pointer flex flex-col gap-3"
                  >
                    <div className="relative aspect-square rounded-xl bg-zinc-900 overflow-hidden border border-zinc-800">
                      {cover ? (
                        <img
                          src={cover}
                          alt={album.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-zinc-700">
                          <Disc3 className="w-12 h-12" />
                        </div>
                      )}
                      <span
                        className={`absolute top-2.5 right-2.5 px-2 py-0.5 rounded text-[10px] font-mono backdrop-blur-md border ${
                          isHiRes
                            ? 'bg-amber-950/85 text-amber-300 border-amber-500/40'
                            : 'bg-zinc-950/80 text-zinc-200 border-zinc-700/60'
                        }`}
                      >
                        {album.format} {album.maxBitsPerSample || 16}-bit
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const albumTracks = tracks
                            .filter((t) => t.albumId === album.id)
                            .sort(
                              (a, b) =>
                                a.discNumber - b.discNumber || a.trackNumber - b.trackNumber
                            );
                          playTrackList(albumTracks, 0);
                        }}
                        className="opacity-0 group-hover:opacity-100 absolute bottom-3 right-3 w-10 h-10 rounded-full bg-amber-500 hover:bg-amber-400 text-zinc-950 flex items-center justify-center shadow-xl transition-all cursor-pointer"
                        title="Play Album"
                      >
                        <Play className="w-4 h-4 fill-current ml-0.5" />
                      </button>
                    </div>

                    <div className="min-w-0 space-y-0.5">
                      <div className="font-semibold text-sm text-zinc-100 truncate">
                        {album.title}
                      </div>
                      <div className="text-xs text-zinc-400 truncate">{album.artist}</div>
                      <div className="text-[11px] font-mono text-zinc-500">
                        {album.trackCount} tracks
                        {album.year ? ` • ${album.year}` : ''}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Artists View */}
        {activeTab === 'artists' && (
          <div className="space-y-6">
            {selectedArtist ? (
              <div className="space-y-6">
                <button
                  onClick={() => setSelectedArtist(null)}
                  className="inline-flex items-center gap-2 text-xs font-medium text-zinc-400 hover:text-zinc-100 cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  All Artists
                </button>
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold text-zinc-100">{selectedArtist}</h2>
                  <button
                    onClick={() => {
                      const artistTracks = filteredTracks.filter(
                        (t) => (t.albumArtist || t.artist) === selectedArtist
                      );
                      playTrackList(artistTracks, 0);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 text-zinc-950 font-semibold text-xs cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Play Artist
                  </button>
                </div>
                <div className="space-y-1">
                  {filteredTracks
                    .filter((t) => (t.albumArtist || t.artist) === selectedArtist)
                    .map((track, idx, arr) => renderTrackRow(track, idx, arr))}
                </div>
              </div>
            ) : (
              <>
                <h2 className="text-xl font-bold text-zinc-100">Artists</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {artistsSummary.map((artist) => (
                    <div
                      key={artist.name}
                      onClick={() => setSelectedArtist(artist.name)}
                      className="flex items-center gap-3.5 p-3.5 rounded-2xl bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800/70 cursor-pointer transition-colors"
                    >
                      <div className="w-14 h-14 rounded-full bg-zinc-800 overflow-hidden shrink-0 border border-zinc-700">
                        {artist.sampleCover ? (
                          <img
                            src={artist.sampleCover}
                            alt={artist.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-amber-400 font-bold">
                            {artist.name.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-zinc-100 truncate">
                          {artist.name}
                        </div>
                        <div className="text-xs text-zinc-400">
                          {artist.albums.size} albums • {artist.tracks.length} tracks
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* All Tracks View */}
        {activeTab === 'tracks' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-zinc-100">All Lossless Tracks</h2>
                <p className="text-xs text-zinc-400">
                  Click any track to stream immediately via HTTP 206 Partial Content
                </p>
              </div>
              {filteredTracks.length > 0 && (
                <button
                  onClick={() => playTrackList(filteredTracks, 0)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Play All ({filteredTracks.length})
                </button>
              )}
            </div>

            <div className="space-y-1">
              {filteredTracks.map((track, idx) => renderTrackRow(track, idx, filteredTracks))}
            </div>
          </div>
        )}

        {/* Drive Folders View */}
        {activeTab === 'folders' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-zinc-100">Google Drive Folder Structure</h2>
              <p className="text-xs text-zinc-400">
                Mirrors your exact Artist / Album directory hierarchy on Google Drive
              </p>
            </div>

            <div className="space-y-6">
              {folderGroups.map(([folderPath, folderTracks]) => (
                <div
                  key={folderPath}
                  className="rounded-2xl bg-zinc-900/40 border border-zinc-800/80 overflow-hidden"
                >
                  <div className="px-5 py-3.5 bg-zinc-900/90 border-b border-zinc-800 flex items-center justify-between">
                    <div className="flex items-center gap-2.5 text-sm font-semibold text-zinc-200">
                      <Folder className="w-4 h-4 text-amber-400" />
                      <span>{folderPath}</span>
                      <span className="text-xs font-mono text-zinc-500">
                        ({folderTracks.length} files)
                      </span>
                    </div>
                    <button
                      onClick={() => playTrackList(folderTracks, 0)}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-medium cursor-pointer"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      Play Folder
                    </button>
                  </div>
                  <div className="p-2 space-y-1">
                    {folderTracks.map((track, idx) =>
                      renderTrackRow(track, idx, folderTracks)
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Playlists View */}
        {activeTab === 'playlists' && (
          <div className="space-y-6 max-w-4xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-zinc-100">Playlists</h2>
                <p className="text-xs text-zinc-400">
                  Synced with your Google Drive library index across Windows & macOS
                </p>
              </div>
              <form onSubmit={handleCreatePlaylist} className="flex items-center gap-2">
                <input
                  type="text"
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  placeholder="New playlist name..."
                  className="px-3.5 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs cursor-pointer"
                >
                  Create
                </button>
              </form>
            </div>

            {playlists.length === 0 ? (
              <div className="p-10 rounded-2xl border border-zinc-800/80 bg-zinc-900/30 text-center space-y-2">
                <ListMusic className="w-8 h-8 text-zinc-600 mx-auto" />
                <div className="text-sm font-medium text-zinc-300">No playlists yet</div>
                <p className="text-xs text-zinc-500">
                  Create a playlist above, then click the playlist icon on any track row to add songs.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {playlists.map((pl) => {
                  const plTracks = pl.trackIds
                    .map((id) => tracks.find((t) => t.id === id))
                    .filter((t): t is Track => Boolean(t));
                  return (
                    <div
                      key={pl.id}
                      className="rounded-2xl bg-zinc-900/40 border border-zinc-800 overflow-hidden"
                    >
                      <div className="px-5 py-3.5 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-semibold text-zinc-100">{pl.name}</h3>
                          <p className="text-xs text-zinc-500">{plTracks.length} tracks</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {plTracks.length > 0 && (
                            <button
                              onClick={() => playTrackList(plTracks, 0)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 text-zinc-950 font-semibold text-xs cursor-pointer"
                            >
                              <Play className="w-3 h-3 fill-current" />
                              Play
                            </button>
                          )}
                          <button
                            onClick={() => handleDeletePlaylist(pl.id)}
                            className="p-1.5 text-zinc-500 hover:text-rose-400 cursor-pointer"
                            title="Delete Playlist"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <div className="p-2">
                        {plTracks.length === 0 ? (
                          <div className="p-4 text-xs text-zinc-500">
                            Hover over any track in Albums or All Tracks and click the playlist icon to add it here.
                          </div>
                        ) : (
                          plTracks.map((t, i) => renderTrackRow(t, i, plTracks))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
};
