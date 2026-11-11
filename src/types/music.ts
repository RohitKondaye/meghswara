export type AudioFormatBadge = 'FLAC' | 'ALAC' | 'WAV' | 'AIFF' | 'AAC' | 'MP3' | 'OGG' | 'OPUS';

export interface Track {
  id: string; // Google Drive fileId
  name: string; // Raw filename
  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  albumId: string;
  trackNumber: number;
  discNumber: number;
  year?: number;
  genre?: string;
  duration: number; // seconds
  size: number; // bytes
  mimeType: string;
  format: AudioFormatBadge;
  isLossless: boolean;
  sampleRate?: number; // e.g., 44100, 48000, 96000, 192000
  bitsPerSample?: number; // e.g., 16, 24
  bitrate?: number; // bps
  folderPath: string; // e.g., "Daft Punk / Random Access Memories"
  parentFolderId: string;
  driveCoverFileId?: string; // If folder has cover.jpg / folder.jpg
  hasEmbeddedCover?: boolean;
  isHeaderIndexed: boolean;
  modifiedTime?: string;
  demoStreamUrl?: string; // Used only for built-in demo mode
  demoCoverUrl?: string;
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  year?: number;
  trackCount: number;
  totalDuration: number;
  format: AudioFormatBadge;
  isLossless: boolean;
  maxSampleRate?: number;
  maxBitsPerSample?: number;
  folderPath: string;
  driveCoverFileId?: string;
  demoCoverUrl?: string;
}

export interface CoverArtRecord {
  albumId: string;
  dataUrl: string; // Compact WebP/JPEG data URL for instant rendering & JSON cloud export
  updatedAt: number;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CloudLibrarySnapshot {
  version: number;
  exportedAt: string;
  rootFolderId: string;
  rootFolderName: string;
  tracks: Track[];
  albums: Album[];
  playlists: Playlist[];
  covers: CoverArtRecord[];
}
