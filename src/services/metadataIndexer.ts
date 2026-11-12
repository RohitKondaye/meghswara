import { db, rebuildAlbumsFromTracks } from '../db/libraryDb';
import type { Track } from '../types/music';
import {
  compressImageBlobToDataUrl,
  createAlbumId,
  fetchDriveByteRange,
  fetchDriveImageAsDataUrl,
} from './driveApi';

export interface ParsedAudioHeader {
  title?: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  trackNumber?: number;
  discNumber?: number;
  year?: number;
  genre?: string;
  sampleRate?: number;
  bitsPerSample?: number;
  duration?: number;
  pictureMime?: string;
  pictureBytes?: Uint8Array;
}

/**
 * Pure binary parser for FLAC metadata blocks (STREAMINFO, VORBIS_COMMENT, PICTURE)
 * from a partial HTTP Range byte buffer.
 */
export function parseFlacHeaderBytes(buffer: Uint8Array): {
  parsed: ParsedAudioHeader;
  neededBytesForPicture?: number;
} {
  const parsed: ParsedAudioHeader = {};
  if (
    buffer.length < 42 ||
    buffer[0] !== 0x66 || // 'f'
    buffer[1] !== 0x4c || // 'L'
    buffer[2] !== 0x61 || // 'a'
    buffer[3] !== 0x43 // 'C'
  ) {
    return { parsed };
  }

  let offset = 4;
  const textDecoder = new TextDecoder('utf-8');
  let neededBytesForPicture: number | undefined;

  while (offset + 4 <= buffer.length) {
    const headerByte = buffer[offset];
    const isLast = (headerByte & 0x80) !== 0;
    const blockType = headerByte & 0x7f;
    const blockLength =
      (buffer[offset + 1] << 16) | (buffer[offset + 2] << 8) | buffer[offset + 3];
    const blockStart = offset + 4;
    const blockEnd = blockStart + blockLength;

    if (blockEnd > buffer.length) {
      if (blockType === 6 || blockType === 4) {
        neededBytesForPicture = blockEnd;
      }
      break;
    }

    if (blockType === 0 && blockLength >= 34) {
      // STREAMINFO block
      const b = buffer.subarray(blockStart, blockStart + 34);
      const sampleRate = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
      const bitsPerSample = (((b[12] & 0x01) << 4) | (b[13] >> 4)) + 1;
      const highSamples = b[13] & 0x0f;
      const lowSamples =
        ((b[14] << 24) >>> 0) + (b[15] << 16) + (b[16] << 8) + b[17];
      const totalSamples = highSamples * 4294967296 + lowSamples;

      if (sampleRate > 0) {
        parsed.sampleRate = sampleRate;
        parsed.bitsPerSample = bitsPerSample;
        if (totalSamples > 0) {
          parsed.duration = totalSamples / sampleRate;
        }
      }
    } else if (blockType === 4) {
      // VORBIS_COMMENT block (little-endian lengths)
      const view = new DataView(buffer.buffer, buffer.byteOffset + blockStart, blockLength);
      let pos = 0;
      if (pos + 4 <= blockLength) {
        const vendorLen = view.getUint32(pos, true);
        pos += 4 + vendorLen;
        if (pos + 4 <= blockLength) {
          const commentCount = view.getUint32(pos, true);
          pos += 4;
          for (let i = 0; i < commentCount && pos + 4 <= blockLength; i++) {
            const cLen = view.getUint32(pos, true);
            pos += 4;
            if (pos + cLen > blockLength) break;
            const commentStr = textDecoder.decode(
              buffer.subarray(blockStart + pos, blockStart + pos + cLen)
            );
            pos += cLen;
            const eqIdx = commentStr.indexOf('=');
            if (eqIdx > 0) {
              const key = commentStr.slice(0, eqIdx).trim().toUpperCase();
              const val = commentStr.slice(eqIdx + 1).trim();
              if (!val) continue;
              switch (key) {
                case 'TITLE':
                  parsed.title = val;
                  break;
                case 'ARTIST':
                  parsed.artist = val;
                  break;
                case 'ALBUMARTIST':
                case 'ALBUM ARTIST':
                  parsed.albumArtist = val;
                  break;
                case 'ALBUM':
                  parsed.album = val;
                  break;
                case 'TRACKNUMBER': {
                  const num = parseInt(val.split('/')[0], 10);
                  if (!isNaN(num)) parsed.trackNumber = num;
                  break;
                }
                case 'DISCNUMBER': {
                  const dNum = parseInt(val.split('/')[0], 10);
                  if (!isNaN(dNum)) parsed.discNumber = dNum;
                  break;
                }
                case 'DATE':
                case 'YEAR': {
                  const yMatch = val.match(/(19\d{2}|20\d{2})/);
                  if (yMatch) parsed.year = parseInt(yMatch[1], 10);
                  break;
                }
                case 'GENRE':
                  parsed.genre = val;
                  break;
              }
            }
          }
        }
      }
    } else if (blockType === 6 && !parsed.pictureBytes) {
      // PICTURE block (big-endian lengths)
      const view = new DataView(buffer.buffer, buffer.byteOffset + blockStart, blockLength);
      let pos = 4; // skip picture type
      if (pos + 4 <= blockLength) {
        const mimeLen = view.getUint32(pos, false);
        pos += 4;
        if (pos + mimeLen + 4 <= blockLength) {
          const mime = textDecoder.decode(
            buffer.subarray(blockStart + pos, blockStart + pos + mimeLen)
          );
          pos += mimeLen;
          const descLen = view.getUint32(pos, false);
          pos += 4 + descLen + 16; // skip width, height, depth, colors (4 * 4 bytes)
          if (pos + 4 <= blockLength) {
            const picDataLen = view.getUint32(pos, false);
            pos += 4;
            if (pos + picDataLen <= blockLength && picDataLen > 0) {
              parsed.pictureMime = mime || 'image/jpeg';
              parsed.pictureBytes = buffer.slice(
                blockStart + pos,
                blockStart + pos + picDataLen
              );
            }
          }
        }
      }
    }

    offset = blockEnd;
    if (isLast) break;
  }

  return { parsed, neededBytesForPicture };
}

export interface IndexerProgress {
  completed: number;
  total: number;
  currentTrackTitle: string;
}

const INITIAL_HEADER_BYTES = 131071; // 128 KB slice for tags & STREAMINFO
const MAX_PICTURE_HEADER_BYTES = 786432; // Up to 768 KB if needed to capture embedded album art once per album

export async function indexTrackHeadersInBackground(
  tracks: Track[],
  onProgress?: (progress: IndexerProgress) => void,
  shouldAbort?: () => boolean
): Promise<void> {
  const unindexed = tracks.filter((t) => !t.isHeaderIndexed && !t.demoStreamUrl);
  if (unindexed.length === 0) return;

  const albumsWithCover = new Set<string>();
  const existingCovers = await db.covers.toArray();
  for (const c of existingCovers) {
    albumsWithCover.add(c.albumId);
  }

  let completed = 0;
  const total = unindexed.length;

  // Process in small batches of 3 concurrent range requests to respect Google Drive rate limits
  for (let i = 0; i < unindexed.length; i += 3) {
    if (shouldAbort?.()) break;
    const batch = unindexed.slice(i, i + 3);

    await Promise.all(
      batch.map(async (track) => {
        if (shouldAbort?.()) return;
        try {
          const upperBound =
            track.size > 0 ? Math.min(track.size - 1, INITIAL_HEADER_BYTES) : INITIAL_HEADER_BYTES;
          let bytes = await fetchDriveByteRange(track.id, 0, upperBound);

          let header: ParsedAudioHeader = {};
          const needAlbumCover = !albumsWithCover.has(track.albumId);

          if (track.format === 'FLAC' || (bytes[0] === 0x66 && bytes[1] === 0x4c)) {
            let flacResult = parseFlacHeaderBytes(bytes);
            header = flacResult.parsed;

            // If this album doesn't have cover art yet and the FLAC header indicates an embedded picture
            // slightly larger than 128KB, fetch just enough bytes once for this album
            if (
              needAlbumCover &&
              !track.driveCoverFileId &&
              !header.pictureBytes &&
              flacResult.neededBytesForPicture &&
              flacResult.neededBytesForPicture <= MAX_PICTURE_HEADER_BYTES
            ) {
              const extendedEnd =
                track.size > 0
                  ? Math.min(track.size - 1, flacResult.neededBytesForPicture)
                  : flacResult.neededBytesForPicture;
              bytes = await fetchDriveByteRange(track.id, 0, extendedEnd);
              flacResult = parseFlacHeaderBytes(bytes);
              header = flacResult.parsed;
            }
          } else {
            // Lazy-load music-metadata only when indexing non-FLAC files (.m4a, .mp3, .wav)
            const { parseBuffer } = await import('music-metadata');
            const mm = await parseBuffer(bytes, {
              mimeType: track.mimeType,
              size: track.size || undefined,
            });
            header = {
              title: mm.common.title,
              artist: mm.common.artist,
              albumArtist: mm.common.albumartist,
              album: mm.common.album,
              trackNumber: mm.common.track.no ?? undefined,
              discNumber: mm.common.disk.no ?? undefined,
              year: mm.common.year,
              genre: mm.common.genre?.[0],
              sampleRate: mm.format.sampleRate,
              bitsPerSample: mm.format.bitsPerSample,
              duration: mm.format.duration,
              pictureMime: mm.common.picture?.[0]?.format,
              pictureBytes: mm.common.picture?.[0]?.data,
            };
          }

          const updatedArtist = header.artist || track.artist;
          const updatedAlbumArtist = header.albumArtist || updatedArtist;
          const updatedAlbum = header.album || track.album;
          const updatedAlbumId = createAlbumId(updatedAlbumArtist, updatedAlbum);

          const updatedTrack: Track = {
            ...track,
            title: header.title || track.title,
            artist: updatedArtist,
            albumArtist: updatedAlbumArtist,
            album: updatedAlbum,
            albumId: updatedAlbumId,
            trackNumber: header.trackNumber || track.trackNumber,
            discNumber: header.discNumber || track.discNumber,
            year: header.year || track.year,
            genre: header.genre || track.genre,
            sampleRate: header.sampleRate || track.sampleRate || 44100,
            bitsPerSample: header.bitsPerSample || track.bitsPerSample || 16,
            duration: header.duration || track.duration,
            bitrate:
              header.duration && track.size
                ? Math.round((track.size * 8) / header.duration)
                : track.bitrate,
            hasEmbeddedCover: Boolean(header.pictureBytes),
            isHeaderIndexed: true,
          };

          await db.tracks.put(updatedTrack);

          // Save cover art once per album (either from folder cover.jpg or embedded FLAC picture)
          if (!albumsWithCover.has(updatedAlbumId)) {
            if (header.pictureBytes && header.pictureBytes.byteLength > 0) {
              albumsWithCover.add(updatedAlbumId);
              const blob = new Blob([header.pictureBytes], {
                type: header.pictureMime || 'image/jpeg',
              });
              const dataUrl = await compressImageBlobToDataUrl(blob, 360).catch(() => null);
              if (dataUrl) {
                await db.covers.put({
                  albumId: updatedAlbumId,
                  dataUrl,
                  updatedAt: Date.now(),
                });
              }
            } else if (track.driveCoverFileId) {
              albumsWithCover.add(updatedAlbumId);
              const dataUrl = await fetchDriveImageAsDataUrl(track.driveCoverFileId);
              if (dataUrl) {
                await db.covers.put({
                  albumId: updatedAlbumId,
                  dataUrl,
                  updatedAt: Date.now(),
                });
              }
            }
          }
        } catch (err) {
          console.warn(`Header index fallback for ${track.name}:`, err);
          await db.tracks.update(track.id, { isHeaderIndexed: true });
        } finally {
          completed += 1;
          onProgress?.({
            completed,
            total,
            currentTrackTitle: track.title,
          });
        }
      })
    );
  }

  await rebuildAlbumsFromTracks();
}
