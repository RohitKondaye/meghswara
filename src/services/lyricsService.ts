import { db } from '../db/libraryDb';
import type { Track } from '../types/music';

export interface LyricLine {
  time: number; // seconds
  text: string;
}

export interface ParsedLyrics {
  trackId: string;
  synced: boolean;
  lines: LyricLine[];
  plainText?: string;
  source?: string;
}

/**
 * Parses standard LRC format ("[01:23.45] Lyric text") into sorted timestamped lines.
 */
export function parseLrcText(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const rawLines = lrc.split(/\r?\n/);
  const timeRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

  for (const raw of rawLines) {
    const matches = [...raw.matchAll(timeRegex)];
    if (matches.length === 0) continue;

    const text = raw.replace(timeRegex, '').trim();
    for (const match of matches) {
      const mins = parseInt(match[1], 10);
      const secs = parseInt(match[2], 10);
      const fracStr = match[3] || '0';
      const frac =
        fracStr.length === 3
          ? parseInt(fracStr, 10) / 1000
          : fracStr.length === 2
          ? parseInt(fracStr, 10) / 100
          : parseInt(fracStr, 10) / 10;

      lines.push({
        time: mins * 60 + secs + frac,
        text: text || '♪',
      });
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}

/**
 * Fetches synchronized LRC or plain lyrics from IndexedDB cache or LRCLIB API.
 */
export async function fetchLyricsForTrack(track: Track): Promise<ParsedLyrics> {
  // Check local IndexedDB cache first
  const cached = await db.lyrics.get(track.id).catch(() => undefined);
  if (cached) {
    if (cached.syncedLyrics) {
      return {
        trackId: track.id,
        synced: true,
        lines: parseLrcText(cached.syncedLyrics),
        plainText: cached.plainLyrics,
        source: 'IndexedDB Cache (LRCLIB)',
      };
    }
    if (cached.plainLyrics) {
      return {
        trackId: track.id,
        synced: false,
        lines: cached.plainLyrics.split(/\r?\n/).map((text, idx) => ({ time: idx * 4, text })),
        plainText: cached.plainLyrics,
        source: 'IndexedDB Cache (LRCLIB)',
      };
    }
  }

  // Built-in demo tracks poetic synced lyrics
  if (track.demoStreamUrl) {
    const demoLrc =
      '[00:00.00] ♪ MeghSwara 24-bit Lossless Reference Stream ♪\n' +
      '[00:03.50] Pure harmonic sine & overtone synthesis\n' +
      '[00:07.50] Bit-perfect gapless dual-deck audio engine\n' +
      '[00:11.50] Streaming directly from the cloud to your ears\n' +
      '[00:15.00] ♪ Preparing seamless gapless handoff... ♪';
    return {
      trackId: track.id,
      synced: true,
      lines: parseLrcText(demoLrc),
      source: 'MeghSwara Reference',
    };
  }

  const cleanTitle = track.title.replace(/\(.*?\)|\[.*?\]/g, '').trim();
  const primaryArtist = track.artist.split(/[;,/]/)[0].trim();

  try {
    const searchParams = new URLSearchParams({
      track_name: cleanTitle,
      artist_name: primaryArtist,
    });
    const res = await fetch(`https://lrclib.net/api/search?${searchParams.toString()}`);
    if (res.ok) {
      const results = (await res.json()) as Array<{
        syncedLyrics?: string | null;
        plainLyrics?: string | null;
        duration?: number;
      }>;

      if (Array.isArray(results) && results.length > 0) {
        // Prefer a match with syncedLyrics and closest duration
        const bestMatch =
          results.find((r) => r.syncedLyrics) ||
          results.find((r) => r.plainLyrics) ||
          results[0];

        if (bestMatch && (bestMatch.syncedLyrics || bestMatch.plainLyrics)) {
          await db.lyrics
            .put({
              trackId: track.id,
              syncedLyrics: bestMatch.syncedLyrics || undefined,
              plainLyrics: bestMatch.plainLyrics || undefined,
              updatedAt: Date.now(),
            })
            .catch(() => {});

          if (bestMatch.syncedLyrics) {
            return {
              trackId: track.id,
              synced: true,
              lines: parseLrcText(bestMatch.syncedLyrics),
              plainText: bestMatch.plainLyrics || undefined,
              source: 'LRCLIB Time-Synced',
            };
          }

          if (bestMatch.plainLyrics) {
            return {
              trackId: track.id,
              synced: false,
              lines: bestMatch.plainLyrics
                .split(/\r?\n/)
                .map((text, idx) => ({ time: idx * 4, text })),
              plainText: bestMatch.plainLyrics,
              source: 'LRCLIB Unsynced',
            };
          }
        }
      }
    }
  } catch (err) {
    console.warn('LRCLIB lookup error:', err);
  }

  return {
    trackId: track.id,
    synced: false,
    lines: [],
  };
}
