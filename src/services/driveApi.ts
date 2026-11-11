import type { AudioFormatBadge, CloudLibrarySnapshot, Track } from '../types/music';
import { getAccessToken } from './googleAuth';

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  parents?: string[];
  modifiedTime?: string;
}

const AUDIO_EXTENSIONS: Record<string, { format: AudioFormatBadge; isLossless: boolean; mime: string }> = {
  '.flac': { format: 'FLAC', isLossless: true, mime: 'audio/flac' },
  '.m4a': { format: 'ALAC', isLossless: true, mime: 'audio/mp4' },
  '.wav': { format: 'WAV', isLossless: true, mime: 'audio/wav' },
  '.aiff': { format: 'AIFF', isLossless: true, mime: 'audio/aiff' },
  '.aif': { format: 'AIFF', isLossless: true, mime: 'audio/aiff' },
  '.mp3': { format: 'MP3', isLossless: false, mime: 'audio/mpeg' },
  '.aac': { format: 'AAC', isLossless: false, mime: 'audio/aac' },
  '.ogg': { format: 'OGG', isLossless: false, mime: 'audio/ogg' },
  '.opus': { format: 'OPUS', isLossless: false, mime: 'audio/ogg' },
};

const COVER_FILENAMES = new Set([
  'cover.jpg',
  'cover.jpeg',
  'cover.png',
  'cover.webp',
  'folder.jpg',
  'folder.jpeg',
  'folder.png',
  'front.jpg',
  'front.png',
  'album.jpg',
]);

export const CLOUD_INDEX_FILENAME = 'aetherhifi-library-index.json';

export function detectAudioFormat(
  filename: string,
  mimeType?: string
): { format: AudioFormatBadge; isLossless: boolean; mime: string } | null {
  const lower = filename.toLowerCase();
  for (const [ext, info] of Object.entries(AUDIO_EXTENSIONS)) {
    if (lower.endsWith(ext)) {
      return info;
    }
  }
  if (mimeType) {
    if (mimeType.includes('flac')) return AUDIO_EXTENSIONS['.flac'];
    if (mimeType.includes('wav')) return AUDIO_EXTENSIONS['.wav'];
    if (mimeType.includes('aiff')) return AUDIO_EXTENSIONS['.aiff'];
    if (mimeType.includes('mp4') || mimeType.includes('m4a')) return AUDIO_EXTENSIONS['.m4a'];
    if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return AUDIO_EXTENSIONS['.mp3'];
    if (mimeType.includes('ogg') || mimeType.includes('opus')) return AUDIO_EXTENSIONS['.ogg'];
  }
  return null;
}

export function createAlbumId(artist: string, album: string): string {
  const normArtist = (artist || 'Unknown Artist').trim().toLowerCase();
  const normAlbum = (album || 'Unknown Album').trim().toLowerCase();
  return `${normArtist}::${normAlbum}`;
}

export interface ParsedPathMetadata {
  title: string;
  artist: string;
  album: string;
  trackNumber: number;
  discNumber: number;
  year?: number;
}

/**
 * Extracts fallback metadata from folder hierarchy (e.g. ["Artist", "Album (2021)"])
 * and filename (e.g. "01 - Track Title.flac" or "1-02 Track Title.flac").
 */
export function parseTrackFromPath(
  fileName: string,
  folderChain: string[]
): ParsedPathMetadata {
  const cleanName = fileName.replace(/\.[^/.]+$/, '').trim();

  let discNumber = 1;
  let trackNumber = 1;
  let title = cleanName;
  let inlineArtist: string | undefined;

  // Match patterns like "1-03 - Song Name", "03 - Song Name", "03. Song Name"
  const discTrackMatch = cleanName.match(/^(?:(\d{1,2})[-.])?(\d{1,3})\s*[-._)\s]\s*(.+)$/);
  if (discTrackMatch) {
    if (discTrackMatch[1]) {
      discNumber = parseInt(discTrackMatch[1], 10);
    }
    trackNumber = parseInt(discTrackMatch[2], 10);
    title = discTrackMatch[3].trim();
  } else {
    // Check if filename is "Artist - Title"
    const artistTitleMatch = cleanName.match(/^(.+?)\s+-\s+(.+)$/);
    if (artistTitleMatch && folderChain.length < 2) {
      inlineArtist = artistTitleMatch[1].trim();
      title = artistTitleMatch[2].trim();
    }
  }

  let artist = inlineArtist || 'Unknown Artist';
  let album = 'Unknown Album';
  let year: number | undefined;

  // Check if last folder is "Disc 1" / "CD 1"
  const effectiveFolders = [...folderChain];
  if (effectiveFolders.length >= 2) {
    const lastFolder = effectiveFolders[effectiveFolders.length - 1];
    const discFolderMatch = lastFolder.match(/^(?:disc|cd)\s*(\d{1,2})$/i);
    if (discFolderMatch) {
      discNumber = parseInt(discFolderMatch[1], 10);
      effectiveFolders.pop();
    }
  }

  if (effectiveFolders.length >= 2) {
    album = effectiveFolders[effectiveFolders.length - 1];
    artist = effectiveFolders[effectiveFolders.length - 2];
  } else if (effectiveFolders.length === 1) {
    const singleFolder = effectiveFolders[0];
    const dashSplit = singleFolder.match(/^(.+?)\s+-\s+(.+)$/);
    if (dashSplit) {
      artist = dashSplit[1].trim();
      album = dashSplit[2].trim();
    } else {
      album = singleFolder.trim();
    }
  }

  // Extract year from album folder if formatted like "Album Name (1973)" or "[1973] Album Name"
  const yearSuffixMatch = album.match(/^(.+?)\s*[([](19\d{2}|20\d{2})[)\]]$/);
  const yearPrefixMatch = album.match(/^[([](19\d{2}|20\d{2})[)\]]\s*(.+)$/);
  if (yearSuffixMatch) {
    album = yearSuffixMatch[1].trim();
    year = parseInt(yearSuffixMatch[2], 10);
  } else if (yearPrefixMatch) {
    year = parseInt(yearPrefixMatch[1], 10);
    album = yearPrefixMatch[2].trim();
  }

  return {
    title,
    artist,
    album,
    trackNumber,
    discNumber,
    year,
  };
}

async function driveFetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getAccessToken();
  if (!token) {
    throw new Error('Not authenticated with Google Drive.');
  }
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Google Drive API error (${response.status}): ${text || response.statusText}`);
  }
  return (await response.json()) as T;
}

export async function listDriveFolders(parentId = 'root'): Promise<DriveFileItem[]> {
  const q = `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType,parents)',
    OrderBy: 'name',
    pageSize: '200',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  const data = await driveFetchJson<{ files: DriveFileItem[] }>(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`
  );
  return data.files || [];
}

export interface ScanProgress {
  foldersScanned: number;
  tracksFound: number;
  currentFolder: string;
}

export async function scanDriveMusicFolder(
  rootFolderId: string,
  rootFolderName: string,
  onProgress?: (progress: ScanProgress) => void
): Promise<Track[]> {
  const discoveredTracks: Track[] = [];
  let foldersScanned = 0;

  interface QueueNode {
    id: string;
    chain: string[];
  }

  const queue: QueueNode[] = [{ id: rootFolderId, chain: [] }];

  while (queue.length > 0) {
    const currentBatch = queue.splice(0, 4); // Scan up to 4 folders concurrently

    await Promise.all(
      currentBatch.map(async (node) => {
        foldersScanned += 1;
        onProgress?.({
          foldersScanned,
          tracksFound: discoveredTracks.length,
          currentFolder: node.chain.length > 0 ? node.chain.join(' / ') : rootFolderName,
        });

        let pageToken: string | undefined;
        const folderFiles: DriveFileItem[] = [];

        do {
          const q = `'${node.id}' in parents and trashed = false`;
          const params = new URLSearchParams({
            q,
            fields: 'nextPageToken,files(id,name,mimeType,size,parents,modifiedTime)',
            pageSize: '500',
            supportsAllDrives: 'true',
            includeItemsFromAllDrives: 'true',
          });
          if (pageToken) {
            params.set('pageToken', pageToken);
          }

          const res = await driveFetchJson<{
            files: DriveFileItem[];
            nextPageToken?: string;
          }>(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);

          if (res.files) {
            folderFiles.push(...res.files);
          }
          pageToken = res.nextPageToken;
        } while (pageToken);

        // Identify folder cover image if present
        let folderCoverFileId: string | undefined;
        for (const item of folderFiles) {
          if (COVER_FILENAMES.has(item.name.toLowerCase())) {
            folderCoverFileId = item.id;
            break;
          }
        }

        for (const item of folderFiles) {
          if (item.mimeType === 'application/vnd.google-apps.folder') {
            queue.push({
              id: item.id,
              chain: [...node.chain, item.name],
            });
            continue;
          }

          const formatInfo = detectAudioFormat(item.name, item.mimeType);
          if (!formatInfo) continue;

          const parsed = parseTrackFromPath(item.name, node.chain);
          const albumId = createAlbumId(parsed.artist, parsed.album);

          discoveredTracks.push({
            id: item.id,
            name: item.name,
            title: parsed.title,
            artist: parsed.artist,
            albumArtist: parsed.artist,
            album: parsed.album,
            albumId,
            trackNumber: parsed.trackNumber,
            discNumber: parsed.discNumber,
            year: parsed.year,
            duration: 0,
            size: Number(item.size || 0),
            mimeType: formatInfo.mime,
            format: formatInfo.format,
            isLossless: formatInfo.isLossless,
            folderPath: node.chain.length > 0 ? node.chain.join(' / ') : rootFolderName,
            parentFolderId: node.id,
            driveCoverFileId: folderCoverFileId,
            isHeaderIndexed: false,
            modifiedTime: item.modifiedTime,
          });
        }

        onProgress?.({
          foldersScanned,
          tracksFound: discoveredTracks.length,
          currentFolder: node.chain.length > 0 ? node.chain.join(' / ') : rootFolderName,
        });
      })
    );
  }

  return discoveredTracks.sort(
    (a, b) =>
      a.albumId.localeCompare(b.albumId) ||
      a.discNumber - b.discNumber ||
      a.trackNumber - b.trackNumber
  );
}

/**
 * Fetches a specific byte range of a Google Drive file.
 * Used to parse FLAC STREAMINFO, VORBIS_COMMENT, and PICTURE metadata headers
 * without downloading the full 40-150 MB lossless audio payload.
 */
export async function fetchDriveByteRange(
  fileId: string,
  start: number,
  end: number
): Promise<Uint8Array> {
  const token = getAccessToken();
  if (!token) {
    throw new Error('Missing Google Drive access token');
  }

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Range: `bytes=${start}-${end}`,
      },
    }
  );

  if (!response.ok && response.status !== 206) {
    throw new Error(`Range request failed (${response.status})`);
  }

  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Downloads an image file from Google Drive and compresses it into a compact Data URL thumbnail
 * for instant album grid rendering.
 */
export async function fetchDriveImageAsDataUrl(fileId: string): Promise<string | null> {
  const token = getAccessToken();
  if (!token) return null;

  try {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (!response.ok) return null;
    const blob = await response.blob();
    return await compressImageBlobToDataUrl(blob, 360);
  } catch {
    return null;
  }
}

export async function compressImageBlobToDataUrl(
  blob: Blob,
  maxDimension = 360
): Promise<string> {
  if (typeof document === 'undefined') {
    return '';
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/webp', 0.82));
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(objectUrl);
      reject(err);
    };
    img.src = objectUrl;
  });
}

/**
 * Searches for `aetherhifi-library-index.json` in Google Drive so the Windows laptop
 * and office MacBook can share the indexed library metadata & playlists automatically.
 */
export async function findCloudIndexFileId(rootFolderId?: string): Promise<string | null> {
  const parentFilter = rootFolderId ? `'${rootFolderId}' in parents and ` : '';
  const q = `${parentFilter}name = '${CLOUD_INDEX_FILENAME}' and trashed = false`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,modifiedTime)',
    pageSize: '5',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  const res = await driveFetchJson<{ files: DriveFileItem[] }>(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`
  );
  if (res.files && res.files.length > 0) {
    return res.files[0].id;
  }
  if (rootFolderId) {
    // Fallback search anywhere in Drive
    return findCloudIndexFileId(undefined);
  }
  return null;
}

export async function loadLibrarySnapshotFromDrive(
  rootFolderId?: string
): Promise<CloudLibrarySnapshot | null> {
  const indexFileId = await findCloudIndexFileId(rootFolderId);
  if (!indexFileId) return null;

  return driveFetchJson<CloudLibrarySnapshot>(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(indexFileId)}?alt=media&supportsAllDrives=true`
  );
}

export async function saveLibrarySnapshotToDrive(
  snapshot: CloudLibrarySnapshot,
  rootFolderId?: string
): Promise<string> {
  const token = getAccessToken();
  if (!token) throw new Error('Not authenticated with Google Drive');

  const existingFileId = await findCloudIndexFileId(rootFolderId);
  const jsonPayload = JSON.stringify(snapshot);

  if (existingFileId) {
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingFileId)}?uploadType=media&supportsAllDrives=true`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: jsonPayload,
      }
    );
    if (!res.ok) {
      throw new Error(`Failed to update cloud index (${res.status})`);
    }
    return existingFileId;
  }

  const metadata = {
    name: CLOUD_INDEX_FILENAME,
    mimeType: 'application/json',
    ...(rootFolderId ? { parents: [rootFolderId] } : {}),
  };

  const boundary = '-------AetherHiFiBoundary' + Date.now();
  const multipartBody =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${jsonPayload}\r\n` +
    `--${boundary}--`;

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to create cloud index (${res.status})`);
  }
  const created = (await res.json()) as { id: string };
  return created.id;
}
