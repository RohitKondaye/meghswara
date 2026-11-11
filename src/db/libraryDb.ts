import Dexie, { type Table } from 'dexie';
import type { Album, CoverArtRecord, Playlist, Track } from '../types/music';

export class LibraryDatabase extends Dexie {
  tracks!: Table<Track, string>;
  albums!: Table<Album, string>;
  covers!: Table<CoverArtRecord, string>;
  playlists!: Table<Playlist, string>;

  constructor() {
    super('AetherHiFiLibraryDB');
    this.version(1).stores({
      tracks: 'id, albumId, artist, album, title, format, isLossless, isHeaderIndexed, folderPath',
      albums: 'id, title, artist, year, isLossless',
      covers: 'albumId, updatedAt',
      playlists: 'id, name, updatedAt',
    });
  }
}

export const db = new LibraryDatabase();

export async function rebuildAlbumsFromTracks(): Promise<Album[]> {
  const allTracks = await db.tracks.toArray();
  const albumMap = new Map<string, Album>();

  for (const track of allTracks) {
    const existing = albumMap.get(track.albumId);
    if (!existing) {
      albumMap.set(track.albumId, {
        id: track.albumId,
        title: track.album,
        artist: track.albumArtist || track.artist,
        year: track.year,
        trackCount: 1,
        totalDuration: track.duration || 0,
        format: track.format,
        isLossless: track.isLossless,
        maxSampleRate: track.sampleRate,
        maxBitsPerSample: track.bitsPerSample,
        folderPath: track.folderPath,
        driveCoverFileId: track.driveCoverFileId,
        demoCoverUrl: track.demoCoverUrl,
      });
    } else {
      existing.trackCount += 1;
      existing.totalDuration += track.duration || 0;
      if (!existing.year && track.year) existing.year = track.year;
      if (track.isLossless) existing.isLossless = true;
      if (track.sampleRate && (!existing.maxSampleRate || track.sampleRate > existing.maxSampleRate)) {
        existing.maxSampleRate = track.sampleRate;
      }
      if (track.bitsPerSample && (!existing.maxBitsPerSample || track.bitsPerSample > existing.maxBitsPerSample)) {
        existing.maxBitsPerSample = track.bitsPerSample;
      }
      if (!existing.driveCoverFileId && track.driveCoverFileId) {
        existing.driveCoverFileId = track.driveCoverFileId;
      }
      if (!existing.demoCoverUrl && track.demoCoverUrl) {
        existing.demoCoverUrl = track.demoCoverUrl;
      }
    }
  }

  const albums = Array.from(albumMap.values()).sort((a, b) =>
    a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title)
  );

  await db.transaction('rw', db.albums, async () => {
    await db.albums.clear();
    await db.albums.bulkPut(albums);
  });

  return albums;
}
