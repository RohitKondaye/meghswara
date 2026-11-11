import type { Track } from '../types/music';

export function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) {
    return '--:--';
  }
  const totalSec = Math.floor(seconds);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatSampleRate(hz?: number): string {
  if (!hz) return '44.1 kHz';
  const khz = hz / 1000;
  return Number.isInteger(khz) ? `${khz} kHz` : `${khz.toFixed(1)} kHz`;
}

export function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    return `${mb.toFixed(1)} MB`;
  }
  return `${Math.round(bytes / 1024)} KB`;
}

export function formatSignalBadge(track: Pick<Track, 'format' | 'isLossless' | 'bitsPerSample' | 'sampleRate'>): {
  label: string;
  tier: 'hires' | 'lossless' | 'lossy';
  detail: string;
} {
  const bits = track.bitsPerSample || 16;
  const sr = track.sampleRate || 44100;
  const isHiRes = track.isLossless && (bits > 16 || sr > 48000);

  if (isHiRes) {
    return {
      label: 'HI-RES LOSSLESS',
      tier: 'hires',
      detail: `${track.format} • ${bits}-bit / ${formatSampleRate(sr)}`,
    };
  }

  if (track.isLossless) {
    return {
      label: 'LOSSLESS',
      tier: 'lossless',
      detail: `${track.format} • ${bits}-bit / ${formatSampleRate(sr)}`,
    };
  }

  return {
    label: track.format,
    tier: 'lossy',
    detail: `${track.format} • ${formatSampleRate(sr)}`,
  };
}
