import { db, rebuildAlbumsFromTracks } from '../db/libraryDb';
import type { Track } from '../types/music';
import { createAlbumId } from './driveApi';

/**
 * Generates a short, real 16-bit / 44.1kHz stereo lossless PCM WAV Blob URL with a warm harmonic chord
 * so the user can test real gapless transitions, seeking, and audio output immediately before connecting Drive.
 */
function createSynthesizedLosslessWavUrl(
  frequencies: [number, number, number],
  durationSec = 18
): string {
  if (typeof URL === 'undefined' || typeof Blob === 'undefined') {
    return '';
  }

  const sampleRate = 44100;
  const numChannels = 2;
  const bitsPerSample = 16;
  const numSamples = sampleRate * durationSec;
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format = 1
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const [f1, f2, f3] = frequencies;
  let offset = 44;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // Smooth fade-in and seamless end for gapless testing
    const env =
      t < 0.25 ? t / 0.25 : t > durationSec - 0.15 ? (durationSec - t) / 0.15 : 1.0;
    const lfo = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.4 * t);

    const waveL =
      (Math.sin(2 * Math.PI * f1 * t) * 0.4 +
        Math.sin(2 * Math.PI * f2 * t) * 0.35 +
        Math.sin(2 * Math.PI * f3 * t) * 0.25) *
      env *
      lfo *
      0.35;

    const waveR =
      (Math.sin(2 * Math.PI * (f1 * 1.001) * t) * 0.4 +
        Math.sin(2 * Math.PI * f2 * t) * 0.35 +
        Math.sin(2 * Math.PI * (f3 * 0.999) * t) * 0.25) *
      env *
      lfo *
      0.35;

    view.setInt16(offset, Math.max(-32768, Math.min(32767, waveL * 32767)), true);
    view.setInt16(offset + 2, Math.max(-32768, Math.min(32767, waveR * 32767)), true);
    offset += 4;
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

function createAlbumCoverSvgDataUrl(
  bgStart: string,
  bgEnd: string,
  accent: string,
  title: string
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${bgStart}" />
        <stop offset="100%" stop-color="${bgEnd}" />
      </linearGradient>
    </defs>
    <rect width="400" height="400" fill="url(#g)" />
    <circle cx="200" cy="200" r="130" fill="none" stroke="${accent}" stroke-width="2" stroke-opacity="0.35" />
    <circle cx="200" cy="200" r="90" fill="none" stroke="${accent}" stroke-width="1.5" stroke-dasharray="8 6" stroke-opacity="0.5" />
    <circle cx="200" cy="200" r="24" fill="${accent}" fill-opacity="0.85" />
    <text x="32" y="356" fill="#ffffff" font-family="system-ui, sans-serif" font-size="22" font-weight="700" letter-spacing="1">${title}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export async function seedDemoLibrary(): Promise<void> {
  const cover1 = createAlbumCoverSvgDataUrl('#0f172a', '#1e1b4b', '#f59e0b', 'HORIZON SUITE');
  const cover2 = createAlbumCoverSvgDataUrl('#052e16', '#064e3b', '#34d399', 'ANALOG ECHOES');
  const cover3 = createAlbumCoverSvgDataUrl('#27272a', '#09090b', '#fb7185', 'MIDNIGHT TAPE');

  const demoTracks: Track[] = [
    {
      id: 'demo-1',
      name: '01 - Prelude in Amber (24-96 Master).flac',
      title: 'Prelude in Amber (Gapless Pt. I)',
      artist: 'Aether Ensemble',
      albumArtist: 'Aether Ensemble',
      album: 'Horizon Suite (24-bit Studio Master)',
      albumId: createAlbumId('Aether Ensemble', 'Horizon Suite (24-bit Studio Master)'),
      trackNumber: 1,
      discNumber: 1,
      year: 2025,
      genre: 'Ambient / Modern Classical',
      duration: 18,
      size: 42_500_000,
      mimeType: 'audio/flac',
      format: 'FLAC',
      isLossless: true,
      sampleRate: 96000,
      bitsPerSample: 24,
      bitrate: 3_120_000,
      folderPath: 'Aether Ensemble / Horizon Suite (2025)',
      parentFolderId: 'demo-folder-1',
      isHeaderIndexed: true,
      demoStreamUrl: createSynthesizedLosslessWavUrl([220.0, 277.18, 329.63], 18),
      demoCoverUrl: cover1,
    },
    {
      id: 'demo-2',
      name: '02 - Glass Meridian (24-96 Master).flac',
      title: 'Glass Meridian (Gapless Pt. II)',
      artist: 'Aether Ensemble',
      albumArtist: 'Aether Ensemble',
      album: 'Horizon Suite (24-bit Studio Master)',
      albumId: createAlbumId('Aether Ensemble', 'Horizon Suite (24-bit Studio Master)'),
      trackNumber: 2,
      discNumber: 1,
      year: 2025,
      genre: 'Ambient / Modern Classical',
      duration: 18,
      size: 46_800_000,
      mimeType: 'audio/flac',
      format: 'FLAC',
      isLossless: true,
      sampleRate: 96000,
      bitsPerSample: 24,
      bitrate: 3_180_000,
      folderPath: 'Aether Ensemble / Horizon Suite (2025)',
      parentFolderId: 'demo-folder-1',
      isHeaderIndexed: true,
      demoStreamUrl: createSynthesizedLosslessWavUrl([246.94, 329.63, 369.99], 18),
      demoCoverUrl: cover1,
    },
    {
      id: 'demo-3',
      name: '03 - Solstice Drift (24-96 Master).flac',
      title: 'Solstice Drift (Gapless Pt. III)',
      artist: 'Aether Ensemble',
      albumArtist: 'Aether Ensemble',
      album: 'Horizon Suite (24-bit Studio Master)',
      albumId: createAlbumId('Aether Ensemble', 'Horizon Suite (24-bit Studio Master)'),
      trackNumber: 3,
      discNumber: 1,
      year: 2025,
      genre: 'Ambient / Modern Classical',
      duration: 18,
      size: 44_100_000,
      mimeType: 'audio/flac',
      format: 'FLAC',
      isLossless: true,
      sampleRate: 96000,
      bitsPerSample: 24,
      bitrate: 3_090_000,
      folderPath: 'Aether Ensemble / Horizon Suite (2025)',
      parentFolderId: 'demo-folder-1',
      isHeaderIndexed: true,
      demoStreamUrl: createSynthesizedLosslessWavUrl([196.0, 293.66, 392.0], 18),
      demoCoverUrl: cover1,
    },
    {
      id: 'demo-4',
      name: '01 - Kyoto Rain (16-44.1 CD Rip).flac',
      title: 'Kyoto Rain',
      artist: 'Kaito Takahashi',
      albumArtist: 'Kaito Takahashi',
      album: 'Analog Echoes',
      albumId: createAlbumId('Kaito Takahashi', 'Analog Echoes'),
      trackNumber: 1,
      discNumber: 1,
      year: 2023,
      genre: 'Electronic / Downtempo',
      duration: 18,
      size: 28_400_000,
      mimeType: 'audio/flac',
      format: 'FLAC',
      isLossless: true,
      sampleRate: 44100,
      bitsPerSample: 16,
      bitrate: 945_000,
      folderPath: 'Kaito Takahashi / Analog Echoes (2023)',
      parentFolderId: 'demo-folder-2',
      isHeaderIndexed: true,
      demoStreamUrl: createSynthesizedLosslessWavUrl([261.63, 329.63, 493.88], 18),
      demoCoverUrl: cover2,
    },
    {
      id: 'demo-5',
      name: '02 - Subterranean Transit.flac',
      title: 'Subterranean Transit',
      artist: 'Kaito Takahashi',
      albumArtist: 'Kaito Takahashi',
      album: 'Analog Echoes',
      albumId: createAlbumId('Kaito Takahashi', 'Analog Echoes'),
      trackNumber: 2,
      discNumber: 1,
      year: 2023,
      genre: 'Electronic / Downtempo',
      duration: 18,
      size: 31_200_000,
      mimeType: 'audio/flac',
      format: 'FLAC',
      isLossless: true,
      sampleRate: 44100,
      bitsPerSample: 16,
      bitrate: 980_000,
      folderPath: 'Kaito Takahashi / Analog Echoes (2023)',
      parentFolderId: 'demo-folder-2',
      isHeaderIndexed: true,
      demoStreamUrl: createSynthesizedLosslessWavUrl([174.61, 261.63, 349.23], 18),
      demoCoverUrl: cover2,
    },
    {
      id: 'demo-6',
      name: '01 - Velvet Static (Apple Lossless).m4a',
      title: 'Velvet Static',
      artist: 'Nocturne Club',
      albumArtist: 'Nocturne Club',
      album: 'Midnight Tape Sessions',
      albumId: createAlbumId('Nocturne Club', 'Midnight Tape Sessions'),
      trackNumber: 1,
      discNumber: 1,
      year: 2024,
      genre: 'Nu-Jazz / Fusion',
      duration: 18,
      size: 36_900_000,
      mimeType: 'audio/mp4',
      format: 'ALAC',
      isLossless: true,
      sampleRate: 48000,
      bitsPerSample: 24,
      bitrate: 1_450_000,
      folderPath: 'Nocturne Club / Midnight Tape Sessions (2024)',
      parentFolderId: 'demo-folder-3',
      isHeaderIndexed: true,
      demoStreamUrl: createSynthesizedLosslessWavUrl([293.66, 349.23, 440.0], 18),
      demoCoverUrl: cover3,
    },
  ];

  await db.transaction('rw', db.tracks, db.covers, async () => {
    await db.tracks.bulkPut(demoTracks);
    await db.covers.bulkPut([
      {
        albumId: demoTracks[0].albumId,
        dataUrl: cover1,
        updatedAt: Date.now(),
      },
      {
        albumId: demoTracks[3].albumId,
        dataUrl: cover2,
        updatedAt: Date.now(),
      },
      {
        albumId: demoTracks[5].albumId,
        dataUrl: cover3,
        updatedAt: Date.now(),
      },
    ]);
  });

  await rebuildAlbumsFromTracks();
}
