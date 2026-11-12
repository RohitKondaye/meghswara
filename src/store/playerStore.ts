import { create } from 'zustand';
import { DualDeckGaplessEngine } from '../audio/gaplessEngine';
import { db } from '../db/libraryDb';
import { reportTelemetry } from '../services/telemetry';
import type { Track } from '../types/music';

export type RepeatMode = 'off' | 'all' | 'one';

export interface PlayerState {
  currentTrack: Track | null;
  queue: Track[];
  originalQueue: Track[];
  currentIndex: number;
  status: 'idle' | 'playing' | 'paused' | 'buffering';
  currentTime: number;
  duration: number;
  bufferedEnd: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  isQueueOpen: boolean;
  isLyricsOpen: boolean;
  isEqOpen: boolean;
  errorMessage: string | null;
  gaplessTransitionsCount: number;

  // Actions
  playTrackList: (tracks: Track[], startIndex?: number) => void;
  playSingleTrack: (track: Track) => void;
  playNextInQueue: (track: Track) => void;
  addToQueue: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  jumpToQueueIndex: (index: number) => void;
  togglePlayPause: () => void;
  nextTrack: () => void;
  previousTrack: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeatMode: () => void;
  toggleQueueDrawer: () => void;
  toggleLyricsDrawer: () => void;
  toggleEqDrawer: () => void;
  syncEqGraph: () => void;
  clearError: () => void;
}

/**
 * Pure helper for computing the next track index in the queue given repeat mode.
 */
export function resolveNextQueueIndex(
  currentIndex: number,
  queueLength: number,
  repeat: RepeatMode
): number {
  if (queueLength === 0) return -1;
  if (repeat === 'one') return currentIndex;
  if (currentIndex + 1 < queueLength) return currentIndex + 1;
  if (repeat === 'all') return 0;
  return -1;
}

/**
 * Fisher-Yates shuffle that keeps the currently playing track at index 0.
 */
export function shuffleQueueKeepingCurrent(tracks: Track[], currentIndex: number): Track[] {
  if (tracks.length <= 1) return [...tracks];
  const current = tracks[currentIndex] ?? tracks[0];
  const rest = tracks.filter((_, idx) => idx !== currentIndex);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [current, ...rest];
}

let engineInstance: DualDeckGaplessEngine | null = null;

async function updateMediaSessionMetadata(track: Track): Promise<void> {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

  let coverUrl = track.demoCoverUrl;
  if (!coverUrl) {
    const coverRecord = await db.covers.get(track.albumId).catch(() => undefined);
    coverUrl = coverRecord?.dataUrl;
  }

  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork: coverUrl ? [{ src: coverUrl, sizes: '360x360', type: 'image/webp' }] : [],
  });
}

export const usePlayerStore = create<PlayerState>((set, get) => {
  const ensureEngine = (): DualDeckGaplessEngine => {
    if (!engineInstance) {
      engineInstance = new DualDeckGaplessEngine({
        onTimeUpdate: (currentTime, duration, bufferedEnd) => {
          set({ currentTime, duration, bufferedEnd });
        },
        onStateChange: (status) => {
          // A successful (re)start clears any stale error toast from a failed first attempt
          set(status === 'playing' ? { status, errorMessage: null } : { status });
        },
        onError: (errorMessage) => {
          reportTelemetry({
            level: 'error',
            category: 'player-onError',
            message: errorMessage,
            track: get().currentTrack,
          });
          set({ status: 'paused', errorMessage });
        },
        getNextTrack: () => {
          const { queue, currentIndex, repeat } = get();
          const nextIdx = resolveNextQueueIndex(currentIndex, queue.length, repeat);
          return nextIdx >= 0 ? queue[nextIdx] ?? null : null;
        },
        onTrackEnded: (wasGaplessHandOff) => {
          const { queue, currentIndex, repeat, gaplessTransitionsCount } = get();
          const nextIdx = resolveNextQueueIndex(currentIndex, queue.length, repeat);
          if (nextIdx < 0) {
            set({ status: 'paused', currentTime: 0 });
            return;
          }
          const nextTrack = queue[nextIdx];
          if (!nextTrack) return;

          if (wasGaplessHandOff) {
            set({
              currentTrack: nextTrack,
              currentIndex: nextIdx,
              currentTime: 0,
              duration: nextTrack.duration || 0,
              status: 'playing',
              gaplessTransitionsCount: gaplessTransitionsCount + 1,
            });
            updateMediaSessionMetadata(nextTrack);
          } else {
            get().jumpToQueueIndex(nextIdx);
          }
        },
      });

      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', () => get().togglePlayPause());
        navigator.mediaSession.setActionHandler('pause', () => get().togglePlayPause());
        navigator.mediaSession.setActionHandler('previoustrack', () => get().previousTrack());
        navigator.mediaSession.setActionHandler('nexttrack', () => get().nextTrack());
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (typeof details.seekTime === 'number') {
            get().seek(details.seekTime);
          }
        });
      }
    }
    return engineInstance;
  };

  return {
    currentTrack: null,
    queue: [],
    originalQueue: [],
    currentIndex: -1,
    status: 'idle',
    currentTime: 0,
    duration: 0,
    bufferedEnd: 0,
    volume: 0.85,
    muted: false,
    shuffle: false,
    repeat: 'off',
    isQueueOpen: false,
    isLyricsOpen: false,
    isEqOpen: false,
    errorMessage: null,
    gaplessTransitionsCount: 0,

    playTrackList: (tracks, startIndex = 0) => {
      if (tracks.length === 0) return;
      const engine = ensureEngine();
      const { shuffle } = get();

      const originalQueue = [...tracks];
      const activeQueue = shuffle
        ? shuffleQueueKeepingCurrent(originalQueue, startIndex)
        : originalQueue;
      const targetIndex = shuffle ? 0 : startIndex;
      const targetTrack = activeQueue[targetIndex];

      set({
        originalQueue,
        queue: activeQueue,
        currentIndex: targetIndex,
        currentTrack: targetTrack,
        currentTime: 0,
        duration: targetTrack.duration || 0,
        errorMessage: null,
      });

      updateMediaSessionMetadata(targetTrack);
      engine.playTrack(targetTrack).catch((err) => {
        const msg = err instanceof Error ? err.message : 'Unable to start playback';
        reportTelemetry({
          level: 'error',
          category: 'playTrack-exception',
          message: msg,
          track: targetTrack,
          details: { name: (err as { name?: string })?.name },
        });
        set({
          status: 'paused',
          errorMessage: msg,
        });
      });
    },

    playSingleTrack: (track) => {
      get().playTrackList([track], 0);
    },

    playNextInQueue: (track) => {
      const { queue, originalQueue, currentIndex, currentTrack } = get();
      if (!currentTrack || queue.length === 0) {
        get().playSingleTrack(track);
        return;
      }
      const nextQueue = [...queue];
      nextQueue.splice(currentIndex + 1, 0, track);
      set({
        queue: nextQueue,
        originalQueue: [...originalQueue, track],
      });
      ensureEngine().preloadNextTrack(nextQueue[currentIndex + 1] ?? null);
    },

    addToQueue: (track) => {
      const { queue, originalQueue, currentTrack } = get();
      if (!currentTrack || queue.length === 0) {
        get().playSingleTrack(track);
        return;
      }
      set({
        queue: [...queue, track],
        originalQueue: [...originalQueue, track],
      });
    },

    removeFromQueue: (index) => {
      const { queue, currentIndex } = get();
      if (index < 0 || index >= queue.length) return;
      const nextQueue = queue.filter((_, idx) => idx !== index);
      let nextIndex = currentIndex;
      if (index < currentIndex) {
        nextIndex -= 1;
      }
      set({ queue: nextQueue, currentIndex: nextIndex });
    },

    jumpToQueueIndex: (index) => {
      const { queue } = get();
      if (index < 0 || index >= queue.length) return;
      const targetTrack = queue[index];
      const engine = ensureEngine();
      set({
        currentIndex: index,
        currentTrack: targetTrack,
        currentTime: 0,
        duration: targetTrack.duration || 0,
        errorMessage: null,
      });
      updateMediaSessionMetadata(targetTrack);
      engine.playTrack(targetTrack).catch((err) => {
        const msg = err instanceof Error ? err.message : 'Unable to start playback';
        reportTelemetry({
          level: 'error',
          category: 'playTrack-exception',
          message: msg,
          track: targetTrack,
          details: { name: (err as { name?: string })?.name },
        });
        set({
          status: 'paused',
          errorMessage: msg,
        });
      });
    },

    togglePlayPause: () => {
      ensureEngine().togglePlayPause();
    },

    nextTrack: () => {
      const { queue, currentIndex, repeat } = get();
      if (queue.length === 0) return;
      const nextIdx =
        repeat === 'one'
          ? (currentIndex + 1) % queue.length
          : resolveNextQueueIndex(currentIndex, queue.length, 'all');
      if (nextIdx >= 0) {
        get().jumpToQueueIndex(nextIdx);
      }
    },

    previousTrack: () => {
      const { currentTime, currentIndex, queue } = get();
      if (queue.length === 0) return;
      if (currentTime > 3) {
        get().seek(0);
        return;
      }
      const prevIdx = currentIndex > 0 ? currentIndex - 1 : queue.length - 1;
      get().jumpToQueueIndex(prevIdx);
    },

    seek: (seconds) => {
      ensureEngine().seek(seconds);
    },

    setVolume: (volume) => {
      ensureEngine().setVolume(volume);
      set({ volume, muted: volume === 0 });
    },

    toggleMute: () => {
      const nextMuted = !get().muted;
      ensureEngine().setMuted(nextMuted);
      set({ muted: nextMuted });
    },

    toggleShuffle: () => {
      const { shuffle, queue, originalQueue, currentIndex, currentTrack } = get();
      const nextShuffle = !shuffle;
      if (!currentTrack || queue.length <= 1) {
        set({ shuffle: nextShuffle });
        return;
      }

      if (nextShuffle) {
        const shuffled = shuffleQueueKeepingCurrent(queue, currentIndex);
        set({
          shuffle: true,
          queue: shuffled,
          currentIndex: 0,
        });
      } else {
        const restoredIndex = Math.max(
          0,
          originalQueue.findIndex((t) => t.id === currentTrack.id)
        );
        set({
          shuffle: false,
          queue: [...originalQueue],
          currentIndex: restoredIndex,
        });
      }
    },

    cycleRepeatMode: () => {
      const order: RepeatMode[] = ['off', 'all', 'one'];
      const next = order[(order.indexOf(get().repeat) + 1) % order.length];
      set({ repeat: next });
    },

    toggleQueueDrawer: () => {
      set((s) => ({
        isQueueOpen: !s.isQueueOpen,
        isLyricsOpen: false,
        isEqOpen: false,
      }));
    },

    toggleLyricsDrawer: () => {
      set((s) => ({
        isLyricsOpen: !s.isLyricsOpen,
        isQueueOpen: false,
        isEqOpen: false,
      }));
    },

    toggleEqDrawer: () => {
      set((s) => ({
        isEqOpen: !s.isEqOpen,
        isQueueOpen: false,
        isLyricsOpen: false,
      }));
    },

    syncEqGraph: () => {
      ensureEngine().connectEqIfEnabled();
    },

    clearError: () => {
      set({ errorMessage: null });
    },
  };
});
