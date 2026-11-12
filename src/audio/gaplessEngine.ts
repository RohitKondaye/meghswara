import {
  buildDriveStreamUrl,
  ensureFreshAccessToken,
  trySilentTokenRefresh,
} from '../services/googleAuth';
import { getCachedTrackBlobUrl } from '../services/offlineCache';
import { eqGraph, useEqualizerStore } from './equalizerEngine';
import type { Track } from '../types/music';

export interface AudioEngineCallbacks {
  onTimeUpdate: (currentTime: number, duration: number, bufferedEnd: number) => void;
  onTrackEnded: (wasGaplessHandOff: boolean) => void;
  onStateChange: (state: 'playing' | 'paused' | 'buffering') => void;
  onError: (message: string) => void;
  getNextTrack: () => Track | null;
}

export class DualDeckGaplessEngine {
  private deckA: HTMLAudioElement;
  private deckB: HTMLAudioElement;
  private activeDeck: HTMLAudioElement;
  private standbyDeck: HTMLAudioElement;
  private activeTrack: Track | null = null;
  private preloadedTrackId: string | null = null;
  private volume = 0.85;
  private muted = false;
  private callbacks: AudioEngineCallbacks;
  private rafId: number | null = null;
  private activeBlobUrl: string | null = null;
  private retriedWithFreshToken = false;

  constructor(callbacks: AudioEngineCallbacks) {
    this.callbacks = callbacks;
    this.deckA = this.createDeck();
    this.deckB = this.createDeck();
    this.activeDeck = this.deckA;
    this.standbyDeck = this.deckB;
    this.bindDeckEvents(this.deckA);
    this.bindDeckEvents(this.deckB);
  }

  private createDeck(): HTMLAudioElement {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.volume = this.volume;
    return audio;
  }

  private revokeActiveBlobUrl(): void {
    if (this.activeBlobUrl) {
      URL.revokeObjectURL(this.activeBlobUrl);
      this.activeBlobUrl = null;
    }
  }

  private resolveStreamUrl(track: Track): string {
    if (track.demoStreamUrl) {
      return track.demoStreamUrl;
    }
    return buildDriveStreamUrl(track.id, track.mimeType || 'audio/flac', track.size);
  }

  private bindDeckEvents(deck: HTMLAudioElement): void {
    deck.addEventListener('playing', () => {
      if (deck !== this.activeDeck) return;
      this.retriedWithFreshToken = false;
      this.callbacks.onStateChange('playing');
      this.startProgressLoop();
    });

    deck.addEventListener('pause', () => {
      if (deck !== this.activeDeck) return;
      if (!deck.ended) {
        this.callbacks.onStateChange('paused');
      }
      this.stopProgressLoop();
    });

    deck.addEventListener('waiting', () => {
      if (deck !== this.activeDeck) return;
      this.callbacks.onStateChange('buffering');
    });

    deck.addEventListener('timeupdate', () => {
      if (deck !== this.activeDeck) return;
      this.emitTimeUpdate();
      this.checkPreloadStandbyDeck();
    });

    deck.addEventListener('loadedmetadata', () => {
      if (deck !== this.activeDeck) return;
      this.emitTimeUpdate();
    });

    deck.addEventListener('ended', () => {
      if (deck !== this.activeDeck) return;
      this.handleTrackEnd();
    });

    deck.addEventListener('error', async () => {
      if (deck !== this.activeDeck || !this.activeTrack) return;
      const track = this.activeTrack;

      // If the OAuth token expired mid-session, attempt one silent token refresh and retry packet stream
      if (!this.retriedWithFreshToken && !track.demoStreamUrl) {
        this.retriedWithFreshToken = true;
        const fresh = await trySilentTokenRefresh();
        if (fresh && this.activeTrack?.id === track.id) {
          deck.src = this.resolveStreamUrl(track);
          deck.load();
          deck.play().catch(() => {});
          return;
        }
      }

      this.callbacks.onError(
        `Unable to stream "${track.title}". Tap "Drive → Reconnect OAuth" if your session expired.`
      );
    });
  }

  private emitTimeUpdate(): void {
    const deck = this.activeDeck;
    const duration =
      Number.isFinite(deck.duration) && deck.duration > 0
        ? deck.duration
        : this.activeTrack?.duration || 0;
    let bufferedEnd = 0;
    if (deck.buffered && deck.buffered.length > 0) {
      bufferedEnd = deck.buffered.end(deck.buffered.length - 1);
    }
    this.callbacks.onTimeUpdate(deck.currentTime || 0, duration, bufferedEnd);
  }

  private startProgressLoop(): void {
    this.stopProgressLoop();
    const tick = () => {
      if (!this.activeDeck.paused) {
        this.emitTimeUpdate();
        const dur = this.activeDeck.duration;
        if (
          Number.isFinite(dur) &&
          dur > 2 &&
          this.preloadedTrackId &&
          dur - this.activeDeck.currentTime <= 0.045
        ) {
          this.handleTrackEnd();
          return;
        }
        this.rafId = requestAnimationFrame(tick);
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopProgressLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private checkPreloadStandbyDeck(): void {
    const deck = this.activeDeck;
    const dur =
      Number.isFinite(deck.duration) && deck.duration > 0
        ? deck.duration
        : this.activeTrack?.duration || 0;
    if (dur <= 0) return;

    const remaining = dur - deck.currentTime;
    // Only preload the next track when <= 12 seconds remain so standbyDeck never steals mobile bandwidth on startup
    if (remaining <= 12) {
      const nextTrack = this.callbacks.getNextTrack();
      if (nextTrack && nextTrack.id !== this.preloadedTrackId) {
        this.preloadNextTrack(nextTrack);
      }
    }
  }

  public preloadNextTrack(track: Track | null): void {
    if (!track) {
      this.preloadedTrackId = null;
      this.standbyDeck.removeAttribute('src');
      return;
    }
    if (this.preloadedTrackId === track.id) return;
    this.preloadedTrackId = track.id;
    this.standbyDeck.preload = 'auto';
    this.standbyDeck.src = this.resolveStreamUrl(track);
    this.standbyDeck.volume = this.muted ? 0 : this.volume;
    this.standbyDeck.load();
  }

  private handleTrackEnd(): void {
    this.stopProgressLoop();
    const nextTrack = this.callbacks.getNextTrack();

    if (nextTrack && this.preloadedTrackId === nextTrack.id && this.standbyDeck.src) {
      const previousDeck = this.activeDeck;
      previousDeck.pause();
      previousDeck.currentTime = 0;

      this.activeDeck = this.standbyDeck;
      this.standbyDeck = previousDeck;
      this.activeTrack = nextTrack;
      this.preloadedTrackId = null;

      this.activeDeck.volume = this.muted ? 0 : this.volume;
      this.activeDeck.play().catch((err) => {
        if (err?.name !== 'AbortError') {
          this.callbacks.onError(err instanceof Error ? err.message : 'Gapless handoff failed');
        }
      });

      this.callbacks.onTrackEnded(true);
    } else {
      this.callbacks.onTrackEnded(false);
    }
  }

  public async playTrack(track: Track): Promise<void> {
    this.stopProgressLoop();
    this.revokeActiveBlobUrl();
    this.retriedWithFreshToken = false;

    // 1. Check if the user has pinned this FLAC track for offline playback!
    const offlineBlobUrl = await getCachedTrackBlobUrl(track.id);
    if (offlineBlobUrl) {
      this.activeTrack = track;
      this.preloadedTrackId = null;
      this.activeBlobUrl = offlineBlobUrl;
      this.activeDeck.src = offlineBlobUrl;
      this.activeDeck.currentTime = 0;
      this.activeDeck.volume = this.muted ? 0 : this.volume;
      if (useEqualizerStore.getState().enabled) {
        this.connectEqIfEnabled();
      }
      try {
        await this.activeDeck.play();
      } catch (err: unknown) {
        if ((err as { name?: string })?.name !== 'AbortError') {
          throw err;
        }
      }
      return;
    }

    // 2. Ensure Google OAuth token is valid (silently auto-refreshing if near expiry)
    if (!track.demoStreamUrl) {
      const validToken = await ensureFreshAccessToken();
      if (!validToken) {
        this.callbacks.onError(
          'Google Drive session expired. Tap "Drive → Reconnect OAuth" at the top to sign in.'
        );
        return;
      }
    }

    if (useEqualizerStore.getState().enabled) {
      this.connectEqIfEnabled();
    }

    if (this.preloadedTrackId === track.id && this.standbyDeck.src) {
      this.activeDeck.pause();
      const prev = this.activeDeck;
      this.activeDeck = this.standbyDeck;
      this.standbyDeck = prev;
      this.activeTrack = track;
      this.preloadedTrackId = null;
      this.activeDeck.currentTime = 0;
      this.activeDeck.volume = this.muted ? 0 : this.volume;
      try {
        await this.activeDeck.play();
      } catch (err: unknown) {
        if ((err as { name?: string })?.name !== 'AbortError') {
          throw err;
        }
      }
      return;
    }

    this.activeTrack = track;
    this.preloadedTrackId = null;
    this.callbacks.onStateChange('buffering');
    this.activeDeck.preload = 'auto';
    this.activeDeck.src = this.resolveStreamUrl(track);
    this.activeDeck.currentTime = 0;
    this.activeDeck.volume = this.muted ? 0 : this.volume;

    try {
      await this.activeDeck.play();
    } catch (err: unknown) {
      // Ignore AbortError when user rapidly taps another track while the previous one is starting
      if ((err as { name?: string })?.name === 'AbortError') {
        return;
      }
      throw err;
    }
  }

  public togglePlayPause(): void {
    if (!this.activeTrack) return;
    if (this.activeDeck.paused) {
      this.activeDeck.play().catch((err: unknown) => {
        if ((err as { name?: string })?.name !== 'AbortError') {
          this.callbacks.onError('Unable to resume playback. Tap "Drive → Reconnect OAuth".');
        }
      });
    } else {
      this.activeDeck.pause();
    }
  }

  public seek(seconds: number): void {
    if (!this.activeTrack) return;
    this.activeDeck.currentTime = Math.max(0, seconds);
    this.emitTimeUpdate();
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (!this.muted) {
      this.activeDeck.volume = this.volume;
      this.standbyDeck.volume = this.volume;
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    const effective = muted ? 0 : this.volume;
    this.activeDeck.volume = effective;
    this.standbyDeck.volume = effective;
  }

  public connectEqIfEnabled(): void {
    const eqState = useEqualizerStore.getState();
    eqGraph.attachAudioElements(this.deckA, this.deckB);
    eqGraph.applySettings(eqState.enabled, eqState.preampDb, eqState.gains);
  }
}
