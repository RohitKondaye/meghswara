import { describe, expect, it } from 'vitest';
import { detectAudioFormat, parseTrackFromPath } from '../services/driveApi';
import { parseFlacHeaderBytes } from '../services/metadataIndexer';
import {
  resolveNextQueueIndex,
  shuffleQueueKeepingCurrent,
} from '../store/playerStore';
import { formatSignalBadge } from '../utils/formatters';
import type { Track } from '../types/music';

describe('Google Drive Folder & Path Metadata Parser', () => {
  it('parses standard Artist / Album (Year) / Track.flac hierarchy', () => {
    const res = parseTrackFromPath('04 - Time.flac', [
      'Pink Floyd',
      'The Dark Side of the Moon (1973)',
    ]);
    expect(res.artist).toBe('Pink Floyd');
    expect(res.album).toBe('The Dark Side of the Moon');
    expect(res.year).toBe(1973);
    expect(res.trackNumber).toBe(4);
    expect(res.discNumber).toBe(1);
    expect(res.title).toBe('Time');
  });

  it('parses multi-disc folders and disc-prefixed filenames', () => {
    const res = parseTrackFromPath('2-07 - Giorgio by Moroder.flac', [
      'Daft Punk',
      'Random Access Memories [2013]',
      'Disc 2',
    ]);
    expect(res.artist).toBe('Daft Punk');
    expect(res.album).toBe('Random Access Memories');
    expect(res.year).toBe(2013);
    expect(res.discNumber).toBe(2);
    expect(res.trackNumber).toBe(7);
    expect(res.title).toBe('Giorgio by Moroder');
  });

  it('detects lossless and lossy audio formats accurately', () => {
    expect(detectAudioFormat('song.flac')?.format).toBe('FLAC');
    expect(detectAudioFormat('song.flac')?.isLossless).toBe(true);
    expect(detectAudioFormat('song.m4a')?.format).toBe('ALAC');
    expect(detectAudioFormat('song.mp3')?.isLossless).toBe(false);
  });
});

describe('Binary Partial-Range FLAC Header Parser', () => {
  it('extracts STREAMINFO (24-bit / 96kHz) and VORBIS_COMMENT tags from partial byte slice', () => {
    // Construct a real binary FLAC header buffer:
    // "fLaC" + STREAMINFO block (type 0, length 34) + VORBIS_COMMENT block (type 4, last=true)
    const vendor = new TextEncoder().encode('reference libFLAC');
    const comments = [
      'TITLE=Contact',
      'ARTIST=Daft Punk',
      'ALBUM=Random Access Memories',
      'TRACKNUMBER=13/13',
      'DATE=2013',
    ].map((c) => new TextEncoder().encode(c));

    let vorbisLen = 4 + vendor.length + 4;
    for (const c of comments) {
      vorbisLen += 4 + c.length;
    }

    const totalLen = 4 + (4 + 34) + (4 + vorbisLen);
    const buf = new Uint8Array(totalLen);
    // "fLaC"
    buf.set([0x66, 0x4c, 0x61, 0x43], 0);

    // Block 0: STREAMINFO (not last, type 0, length 34)
    buf[4] = 0x00;
    buf[5] = 0x00;
    buf[6] = 0x00;
    buf[7] = 34;

    // STREAMINFO bytes 10..17 inside block (offset 8 + 10 = 18)
    // Sample Rate = 96000 (0x17700), Channels = 2 (1), BitsPerSample = 24 (23 = 0x17), TotalSamples = 960000 (10 sec)
    const sampleRate = 96000;
    const bpsMinus1 = 23;
    const totalSamples = 960000;
    const sOffset = 8;
    buf[sOffset + 10] = (sampleRate >> 12) & 0xff;
    buf[sOffset + 11] = (sampleRate >> 4) & 0xff;
    buf[sOffset + 12] = ((sampleRate & 0x0f) << 4) | (1 << 1) | ((bpsMinus1 >> 4) & 0x01);
    buf[sOffset + 13] = ((bpsMinus1 & 0x0f) << 4) | 0;
    buf[sOffset + 14] = (totalSamples >> 24) & 0xff;
    buf[sOffset + 15] = (totalSamples >> 16) & 0xff;
    buf[sOffset + 16] = (totalSamples >> 8) & 0xff;
    buf[sOffset + 17] = totalSamples & 0xff;

    // Block 4: VORBIS_COMMENT (isLast = 0x80 | 4 = 0x84)
    const vHeaderOffset = 8 + 34;
    buf[vHeaderOffset] = 0x84;
    buf[vHeaderOffset + 1] = (vorbisLen >> 16) & 0xff;
    buf[vHeaderOffset + 2] = (vorbisLen >> 8) & 0xff;
    buf[vHeaderOffset + 3] = vorbisLen & 0xff;

    const view = new DataView(buf.buffer, vHeaderOffset + 4, vorbisLen);
    let pos = 0;
    view.setUint32(pos, vendor.length, true);
    pos += 4;
    buf.set(vendor, vHeaderOffset + 4 + pos);
    pos += vendor.length;
    view.setUint32(pos, comments.length, true);
    pos += 4;
    for (const c of comments) {
      view.setUint32(pos, c.length, true);
      pos += 4;
      buf.set(c, vHeaderOffset + 4 + pos);
      pos += c.length;
    }

    const { parsed } = parseFlacHeaderBytes(buf);
    expect(parsed.sampleRate).toBe(96000);
    expect(parsed.bitsPerSample).toBe(24);
    expect(parsed.duration).toBeCloseTo(10, 2);
    expect(parsed.title).toBe('Contact');
    expect(parsed.artist).toBe('Daft Punk');
    expect(parsed.album).toBe('Random Access Memories');
    expect(parsed.trackNumber).toBe(13);
    expect(parsed.year).toBe(2013);
  });
});

describe('Queue & Lossless Signal Badge Logic', () => {
  it('resolves next queue index across repeat modes', () => {
    expect(resolveNextQueueIndex(0, 3, 'off')).toBe(1);
    expect(resolveNextQueueIndex(2, 3, 'off')).toBe(-1);
    expect(resolveNextQueueIndex(2, 3, 'all')).toBe(0);
    expect(resolveNextQueueIndex(1, 3, 'one')).toBe(1);
  });

  it('shuffles queue while keeping active track at index 0', () => {
    const mockTracks = [
      { id: '1', title: 'One' },
      { id: '2', title: 'Two' },
      { id: '3', title: 'Three' },
      { id: '4', title: 'Four' },
    ] as Track[];
    const shuffled = shuffleQueueKeepingCurrent(mockTracks, 2);
    expect(shuffled).toHaveLength(4);
    expect(shuffled[0].id).toBe('3');
  });

  it('formats Hi-Res vs CD Lossless signal badges', () => {
    const hiRes = formatSignalBadge({
      format: 'FLAC',
      isLossless: true,
      bitsPerSample: 24,
      sampleRate: 96000,
    });
    expect(hiRes.tier).toBe('hires');
    expect(hiRes.detail).toContain('24-bit / 96 kHz');

    const cdLossless = formatSignalBadge({
      format: 'FLAC',
      isLossless: true,
      bitsPerSample: 16,
      sampleRate: 44100,
    });
    expect(cdLossless.tier).toBe('lossless');
    expect(cdLossless.detail).toContain('16-bit / 44.1 kHz');
  });
});
