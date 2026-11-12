import React, { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, rebuildAlbumsFromTracks } from './db/libraryDb';
import { seedDemoLibrary } from './services/demoLibrary';
import {
  getAccessToken,
  getSavedRootFolder,
  registerStreamServiceWorker,
  setSavedRootFolder,
  subscribeAuthChanges,
  type DriveRootFolderConfig,
} from './services/googleAuth';
import {
  loadLibrarySnapshotFromDrive,
  saveLibrarySnapshotToDrive,
  scanDriveMusicFolder,
  type ScanProgress,
} from './services/driveApi';
import {
  indexTrackHeadersInBackground,
  type IndexerProgress,
} from './services/metadataIndexer';
import { Sidebar, type NavTab } from './components/Sidebar';
import { LibraryViews } from './components/LibraryViews';
import { PlayerBar } from './components/PlayerBar';
import { DriveSetupModal } from './components/DriveSetupModal';
import { usePlayerStore } from './store/playerStore';
import { useOfflineStore } from './services/offlineCache';

export function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('albums');
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [isDriveModalOpen, setIsDriveModalOpen] = useState(false);
  const [isConnected, setIsConnected] = useState<boolean>(Boolean(getAccessToken()));
  const [rootFolder, setRootFolder] = useState<DriveRootFolderConfig | null>(
    getSavedRootFolder()
  );
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [indexerProgress, setIndexerProgress] = useState<IndexerProgress | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);

  const tracks = useLiveQuery(() => db.tracks.toArray(), [], []);
  const albums = useLiveQuery(() => db.albums.toArray(), [], []);
  const playlists = useLiveQuery(() => db.playlists.toArray(), [], []);
  const covers = useLiveQuery(() => db.covers.toArray(), [], []);

  const coverMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of covers) {
      map.set(c.albumId, c.dataUrl);
    }
    return map;
  }, [covers]);

  // Initialize Service Worker, Offline Cache index, & seed demo library if DB is empty
  useEffect(() => {
    registerStreamServiceWorker();
    useOfflineStore.getState().refreshPinnedList();
    const unsub = subscribeAuthChanges(async (token) => {
      const connected = Boolean(token);
      setIsConnected(connected);
      if (connected) {
        // If this device only has demo tracks (or is empty), automatically pull the saved library index from Google Drive!
        const realTrackCount = await db.tracks.filter((t) => !t.demoStreamUrl).count();
        if (realTrackCount === 0) {
          await handleLoadCloudIndex(getSavedRootFolder()?.id, true);
        }
      }
    });

    (async () => {
      const count = await db.tracks.count();
      if (count === 0) {
        await seedDemoLibrary();
      }
    })();

    return unsub;
  }, []);

  // Global keyboard shortcuts (Space = Play/Pause, Left/Right = Seek 5s)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        usePlayerStore.getState().togglePlayPause();
      } else if (e.code === 'ArrowRight' && e.altKey) {
        e.preventDefault();
        usePlayerStore.getState().nextTrack();
      } else if (e.code === 'ArrowLeft' && e.altKey) {
        e.preventDefault();
        usePlayerStore.getState().previousTrack();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleStartFolderScan = async (folder: DriveRootFolderConfig) => {
    setRootFolder(folder);
    setSavedRootFolder(folder);
    setIsDriveModalOpen(false);
    setStatusMessage(null);

    try {
      setScanProgress({
        foldersScanned: 0,
        tracksFound: 0,
        currentFolder: folder.name,
      });

      const discovered = await scanDriveMusicFolder(folder.id, folder.name, (prog) => {
        setScanProgress({ ...prog });
      });

      setScanProgress(null);

      if (discovered.length === 0) {
        setStatusMessage(`No audio files (.flac, .m4a, .wav, .mp3) found in "${folder.name}".`);
        setIsDriveModalOpen(true);
        return;
      }

      // Replace demo tracks with discovered Google Drive tracks, preserving already-indexed metadata if IDs match
      const existingMap = new Map(tracks.map((t) => [t.id, t]));
      const mergedTracks = discovered.map((d) => {
        const prev = existingMap.get(d.id);
        if (prev && prev.isHeaderIndexed && prev.modifiedTime === d.modifiedTime) {
          return prev;
        }
        return d;
      });

      await db.transaction('rw', db.tracks, async () => {
        await db.tracks.clear();
        await db.tracks.bulkPut(mergedTracks);
      });

      await rebuildAlbumsFromTracks();

      // Start Stage 2: Partial HTTP Range FLAC Header & Cover Art Indexer in background
      setIndexerProgress({
        completed: 0,
        total: mergedTracks.filter((t) => !t.isHeaderIndexed).length,
        currentTrackTitle: mergedTracks[0]?.title || '',
      });

      await indexTrackHeadersInBackground(mergedTracks, (prog) => {
        setIndexerProgress({ ...prog });
      });

      setIndexerProgress(null);

      // Automatically save the indexed snapshot to Drive so the second laptop can load it in 1s
      await handleSaveCloudIndex(folder.id, true);
    } catch (err) {
      setScanProgress(null);
      setIndexerProgress(null);
      setStatusMessage(
        err instanceof Error ? err.message : 'Error scanning Google Drive folder'
      );
      setIsDriveModalOpen(true);
    }
  };

  const handleSaveCloudIndex = async (folderId?: string, silent = false) => {
    setIsSyncingCloud(true);
    try {
      const [allTracks, allAlbums, allPlaylists, allCovers] = await Promise.all([
        db.tracks.filter((t) => !t.demoStreamUrl).toArray(),
        db.albums.toArray(),
        db.playlists.toArray(),
        db.covers.toArray(),
      ]);

      const targetFolderId = folderId || rootFolder?.id;
      await saveLibrarySnapshotToDrive(
        {
          version: 1,
          exportedAt: new Date().toISOString(),
          rootFolderId: targetFolderId || 'root',
          rootFolderName: rootFolder?.name || 'My Drive',
          tracks: allTracks,
          albums: allAlbums,
          playlists: allPlaylists,
          covers: allCovers,
        },
        targetFolderId
      );

      if (!silent) {
        setStatusMessage(
          `Saved ${allTracks.length} tracks & ${allPlaylists.length} playlists to Google Drive (${
            rootFolder?.name || 'Drive'
          }). Open MeghSwara on your other laptop and click "Load Index from Drive"!`
        );
      }
    } catch (err) {
      if (!silent) {
        setStatusMessage(
          err instanceof Error ? err.message : 'Failed to save cloud index to Drive'
        );
      }
    } finally {
      setIsSyncingCloud(false);
    }
  };

  const handleLoadCloudIndex = async (folderId?: string, silentIfMissing = false) => {
    setIsSyncingCloud(true);
    if (!silentIfMissing) {
      setStatusMessage(null);
    }
    try {
      const snapshot = await loadLibrarySnapshotFromDrive(folderId || rootFolder?.id);
      if (!snapshot) {
        if (!silentIfMissing) {
          setStatusMessage(
            'No saved library index found in this folder yet. Run "Scan & Index Folder" first.'
          );
        }
        return;
      }

      await db.transaction('rw', db.tracks, db.albums, db.playlists, db.covers, async () => {
        await db.tracks.clear();
        await db.albums.clear();
        await db.tracks.bulkPut(snapshot.tracks || []);
        await db.albums.bulkPut(snapshot.albums || []);
        if (snapshot.playlists?.length) {
          await db.playlists.bulkPut(snapshot.playlists);
        }
        if (snapshot.covers?.length) {
          await db.covers.bulkPut(snapshot.covers);
        }
      });

      const folderCfg = {
        id: snapshot.rootFolderId || 'root',
        name: snapshot.rootFolderName || 'My Drive',
      };
      setRootFolder(folderCfg);
      setSavedRootFolder(folderCfg);
      setStatusMessage(
        `Loaded ${snapshot.tracks.length} lossless tracks & ${snapshot.albums.length} albums from Google Drive in 1 step!`
      );
      setIsDriveModalOpen(false);
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : 'Failed to load library index from Drive'
      );
    } finally {
      setIsSyncingCloud(false);
    }
  };

  return (
    <div className="h-dvh w-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
        <Sidebar
          activeTab={activeTab}
          onSelectTab={(tab) => {
            setActiveTab(tab);
            if (tab !== 'albums') {
              setSelectedAlbumId(null);
            }
          }}
          isConnected={isConnected}
          rootFolderName={rootFolder?.name}
          trackCount={tracks.length}
          albumCount={albums.length}
          scanProgress={scanProgress}
          indexerProgress={indexerProgress}
          onOpenDriveModal={() => setIsDriveModalOpen(true)}
          onQuickSyncToCloud={() => handleSaveCloudIndex(rootFolder?.id, false)}
          isSyncingCloud={isSyncingCloud}
        />

        <LibraryViews
          activeTab={activeTab}
          tracks={tracks}
          albums={albums}
          playlists={playlists}
          coverMap={coverMap}
          selectedAlbumId={selectedAlbumId}
          onSelectAlbumId={(albumId) => {
            setActiveTab('albums');
            setSelectedAlbumId(albumId);
          }}
        />
      </div>

      <PlayerBar
        coverMap={coverMap}
        onNavigateToAlbum={(albumId) => {
          setActiveTab('albums');
          setSelectedAlbumId(albumId);
        }}
      />

      <DriveSetupModal
        isOpen={isDriveModalOpen}
        onClose={() => setIsDriveModalOpen(false)}
        isConnected={isConnected}
        onStartFolderScan={handleStartFolderScan}
        onLoadCloudIndex={handleLoadCloudIndex}
        onSaveCloudIndex={(folderId) => handleSaveCloudIndex(folderId, false)}
        statusMessage={statusMessage}
      />
    </div>
  );
}
export default App;
