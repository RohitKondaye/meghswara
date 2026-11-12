import { create } from 'zustand';
import type { Track } from '../types/music';
import { ensureFreshAccessToken } from './googleAuth';

export const OFFLINE_CACHE_NAME = 'meghswara-offline-flac-v1';

export function getOfflineCacheKey(trackId: string): string {
  return `/offline-flac/${encodeURIComponent(trackId)}`;
}

interface OfflineStoreState {
  pinnedTrackIds: Set<string>;
  downloadingProgress: Record<string, number>; // trackId -> 0..100
  refreshPinnedList: () => Promise<void>;
  pinTrack: (track: Track) => Promise<boolean>;
  unpinTrack: (trackId: string) => Promise<void>;
  pinAlbumTracks: (tracks: Track[]) => Promise<void>;
}

export async function getCachedTrackBlobUrl(trackId: string): Promise<string | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(OFFLINE_CACHE_NAME);
    const match = await cache.match(getOfflineCacheKey(trackId));
    if (!match) return null;
    const blob = await match.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export const useOfflineStore = create<OfflineStoreState>((set, get) => ({
  pinnedTrackIds: new Set<string>(),
  downloadingProgress: {},

  refreshPinnedList: async () => {
    if (typeof caches === 'undefined') return;
    try {
      const cache = await caches.open(OFFLINE_CACHE_NAME);
      const keys = await cache.keys();
      const ids = new Set<string>();
      for (const req of keys) {
        const url = new URL(req.url);
        if (url.pathname.startsWith('/offline-flac/')) {
          ids.add(decodeURIComponent(url.pathname.replace('/offline-flac/', '')));
        }
      }
      set({ pinnedTrackIds: ids });
    } catch (err) {
      console.warn('Unable to inspect offline cache:', err);
    }
  },

  pinTrack: async (track: Track) => {
    if (typeof caches === 'undefined') return false;
    if (get().pinnedTrackIds.has(track.id)) return true;

    set((s) => ({
      downloadingProgress: { ...s.downloadingProgress, [track.id]: 1 },
    }));

    try {
      let response: Response;
      if (track.demoStreamUrl) {
        response = await fetch(track.demoStreamUrl);
      } else {
        const token = await ensureFreshAccessToken();
        if (!token) {
          throw new Error('Not signed in to Google Drive');
        }
        const driveUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          track.id
        )}?alt=media&supportsAllDrives=true`;
        response = await fetch(driveUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }

      if (!response.ok) {
        throw new Error(`Download failed (${response.status})`);
      }

      const contentLength = Number(response.headers.get('Content-Length') || track.size || 0);
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            received += value.byteLength;
            if (contentLength > 0) {
              const pct = Math.min(99, Math.round((received / contentLength) * 100));
              set((s) => ({
                downloadingProgress: { ...s.downloadingProgress, [track.id]: pct },
              }));
            }
          }
        }
      } else {
        const buf = await response.arrayBuffer();
        chunks.push(new Uint8Array(buf));
        received = buf.byteLength;
      }

      const mime =
        track.mimeType && track.mimeType !== 'application/x-flac'
          ? track.mimeType
          : 'audio/flac';
      const blob = new Blob(chunks as BlobPart[], { type: mime });
      const cache = await caches.open(OFFLINE_CACHE_NAME);
      await cache.put(
        getOfflineCacheKey(track.id),
        new Response(blob, {
          headers: {
            'Content-Type': mime,
            'Content-Length': String(blob.size),
          },
        })
      );

      set((s) => {
        const nextIds = new Set(s.pinnedTrackIds);
        nextIds.add(track.id);
        const nextProg = { ...s.downloadingProgress };
        delete nextProg[track.id];
        return { pinnedTrackIds: nextIds, downloadingProgress: nextProg };
      });
      return true;
    } catch (err) {
      console.warn('Offline pin failed:', err);
      set((s) => {
        const nextProg = { ...s.downloadingProgress };
        delete nextProg[track.id];
        return { downloadingProgress: nextProg };
      });
      return false;
    }
  },

  unpinTrack: async (trackId: string) => {
    if (typeof caches === 'undefined') return;
    try {
      const cache = await caches.open(OFFLINE_CACHE_NAME);
      await cache.delete(getOfflineCacheKey(trackId));
      set((s) => {
        const nextIds = new Set(s.pinnedTrackIds);
        nextIds.delete(trackId);
        return { pinnedTrackIds: nextIds };
      });
    } catch (err) {
      console.warn('Failed to unpin track:', err);
    }
  },

  pinAlbumTracks: async (tracks: Track[]) => {
    for (const track of tracks) {
      await get().pinTrack(track);
    }
  },
}));
