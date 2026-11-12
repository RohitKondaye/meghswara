import { buildDriveStreamUrl, getAccessToken } from '../services/googleAuth';
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
  private isTryingBlobFallback = false;

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
    audio.preload = 'auto';
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
    // Always route through /drive-stream/:fileId (served by Service Worker or Cloudflare Pages Function)
    // which normalizes Google Drive's 'application/x-flac' to 'audio/flac' for mobile browsers.
    return buildDriveStreamUrl(track.id, track.mimeType || 'audio/flac');
  }

  /**
   * Mobile fallback: if the native <audio> element on Android/iOS rejects the streaming URL
   * with NotSupportedError, fetch the file directly from Google Drive API with Bearer auth
   * and wrap it in a clean audio/flac Blob URL.
   */
  private async playViaAuthenticatedBlobFallback(track: Track): Promise<void> {
    const token = getAccessToken();
    if (!token) {
      this.callbacks.onError(
        'Google Drive session expired. Tap "Drive → Reconnect OAuth" at the top to sign in.'
      );
      return;
    }

    this.isTryingBlobFallback = true;
    this.callbacks.onStateChange('buffering');

    try {
      const driveUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        track.id
      )}?alt=media&supportsAllDrives=true`;

      const res = await fetch(driveUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.status === 401 || res.status === 403) {
        this.callbacks.onError(
          'Google Drive session expired (1h token). Tap "Drive → Reconnect OAuth" to refresh.'
        );
        return;
      }

      if (!res.ok) {
        this.callbacks.onError(`Google Drive error (${res.status}) loading "${track.title}".`);
        return;
      }

      const arrayBuffer = await res.arrayBuffer();
      if (this.activeTrack?.id !== track.id) return; // User switched tracks while buffering

      this.revokeActiveBlobUrl();
      const mime = track.mimeType && track.mimeType !== 'application/x-flac'
        ? track.mimeType
        : 'audio/flac';
      const blob = new Blob([arrayBuffer], { type: mime });
      this.activeBlobUrl = URL.createObjectURL(blob);

      this.activeDeck.src = this.activeBlobUrl;
      this.activeDeck.currentTime = 0;
      this.activeDeck.volume = this.muted ? 0 : this.volume;
      await this.activeDeck.play();
    } catch (err) {
      this.callbacks.onError(
        err instanceof Error ? err.message : `Unable to play "${track.title}"`
      );
    } finally {
      this.isTryingBlobFallback = false;
    }
  }

  private bindDeckEvents(deck: HTMLAudioElement): void {
    deck.addEventListener('playing', () => {
      if (deck !== this.activeDeck) return;
      this.callbacks.onStateChange('playing');
      this.startProgressLoop();
    });

    deck.addEventListener('pause', () => {
      if (deck !== this.activeDeck) return;
      if (!deck.ended && !this.isTryingBlobFallback) {
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

    deck.addEventListener('error', () => {
      if (deck !== this.activeDeck || !this.activeTrack) return;
      if (!this.isTryingBlobFallback && !deck.src.startsWith('blob:')) {
        this.playViaAuthenticatedBlobFallback(this.activeTrack);
        return;
      }
      this.callbacks.onError(
        `Unable to stream "${this.activeTrack.title}". Tap "Drive → Reconnect OAuth" if your session expired.`
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
    if (remaining <= 15 || deck.currentTime / dur >= 0.72) {
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
      this.activeDeck.play().catch(() => {
        this.playViaAuthenticatedBlobFallback(nextTrack);
      });

      this.callbacks.onTrackEnded(true);
    } else {
      this.callbacks.onTrackEnded(false);
    }
  }

  public async playTrack(track: Track): Promise<void> {
    this.stopProgressLoop();
    this.revokeActiveBlobUrl();
    this.isTryingBlobFallback = false;

    if (!track.demoStreamUrl && !getAccessToken()) {
      this.callbacks.onError(
        'Google Drive session expired. Tap "Drive → Reconnect OAuth" at the top to sign in.'
      );
      return;
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
        return;
      } catch {
        await this.playViaAuthenticatedBlobFallback(track);
        return;
      }
    }

    this.activeTrack = track;
    this.preloadedTrackId = null;
    this.callbacks.onStateChange('buffering');
    this.activeDeck.src = this.resolveStreamUrl(track);
    this.activeDeck.currentTime = 0;
    this.activeDeck.volume = this.muted ? 0 : this.volume;

    try {
      await this.activeDeck.play();
    } catch {
      // If mobile browser rejected /drive-stream/ with NotSupportedError, seamlessly fall back to authenticated Blob stream
      await this.playViaAuthenticatedBlobFallback(track);
    }
  }

  public togglePlayPause(): void {
    if (!this.activeTrack) return;
    if (this.activeDeck.paused) {
      this.activeDeck.play().catch(() => {
        if (this.activeTrack) {
          this.playViaAuthenticatedBlobFallback(this.activeTrack);
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
}
