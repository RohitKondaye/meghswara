/**
 * Cloudflare Pages Edge Function for /drive-stream/:fileId
 * Implements Adaptive HTTP 206 Packet Streaming:
 * - Initial startup packet (start === 0): 768 KB slice for sub-second mobile playback start
 * - Subsequent rolling packets (start > 0): 2 MB slices for smooth continuous buffering & seeking
 */

interface Env {}

const INITIAL_PACKET_BYTES = 786_432; // 768 KB fast-start packet
const ROLLING_PACKET_BYTES = 2_097_152; // 2 MB rolling packet

function parseCookieToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)meghswara_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Converts an open-ended Range header ("bytes=0-" or "bytes=524288-") into a bounded packet Range
 * ("bytes=0-786431") so Google Drive returns fast packets instead of a single 45 MB response.
 */
function buildPacketRangeHeader(
  incomingRange: string | null,
  knownFileSize: number
): string {
  if (!incomingRange || !incomingRange.startsWith('bytes=')) {
    const end =
      knownFileSize > 0
        ? Math.min(knownFileSize - 1, INITIAL_PACKET_BYTES - 1)
        : INITIAL_PACKET_BYTES - 1;
    return `bytes=0-${end}`;
  }

  const spec = incomingRange.replace('bytes=', '').trim();
  const [startStr, endStr] = spec.split('-');
  const start = parseInt(startStr, 10);

  if (isNaN(start) || start < 0) {
    return incomingRange;
  }

  // If the browser explicitly requested a bounded range (e.g. bytes=0-65535), honor it if reasonable
  if (endStr && endStr.trim().length > 0) {
    const requestedEnd = parseInt(endStr, 10);
    if (!isNaN(requestedEnd) && requestedEnd >= start) {
      const maxSpan = start === 0 ? INITIAL_PACKET_BYTES : ROLLING_PACKET_BYTES;
      const cappedEnd = Math.min(requestedEnd, start + maxSpan - 1);
      return `bytes=${start}-${
        knownFileSize > 0 ? Math.min(knownFileSize - 1, cappedEnd) : cappedEnd
      }`;
    }
  }

  // Open-ended range ("bytes=0-" or "bytes=786432-"): cap to packet size!
  const packetSize = start === 0 ? INITIAL_PACKET_BYTES : ROLLING_PACKET_BYTES;
  let targetEnd = start + packetSize - 1;
  if (knownFileSize > 0) {
    targetEnd = Math.min(knownFileSize - 1, targetEnd);
  }
  return `bytes=${start}-${targetEnd}`;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, params } = context;
  const origin = request.headers.get('Origin') || '*';

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Authorization, Content-Type',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  }

  const rawFileId = params.fileId;
  const fileId = Array.isArray(rawFileId) ? rawFileId[0] : rawFileId;
  if (!fileId) {
    return new Response('Missing Google Drive fileId', { status: 400 });
  }

  const url = new URL(request.url);
  const fallbackMime = url.searchParams.get('mime') || 'audio/flac';
  const knownFileSize = Number(url.searchParams.get('size') || '0');

  const authHeader = request.headers.get('Authorization');
  const cookieToken = parseCookieToken(request.headers.get('Cookie'));
  const queryToken = url.searchParams.get('token');
  const token =
    authHeader?.replace(/^Bearer\s+/i, '').trim() || cookieToken || queryToken;

  if (!token) {
    return new Response('Missing Google Drive OAuth token', { status: 401 });
  }

  const upstreamHeaders = new Headers();
  upstreamHeaders.set('Authorization', `Bearer ${token}`);

  const incomingRange = request.headers.get('Range');
  const packetRange = buildPacketRangeHeader(incomingRange, knownFileSize);
  upstreamHeaders.set('Range', packetRange);

  const driveUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    fileId
  )}?alt=media&supportsAllDrives=true`;

  const upstream = await fetch(driveUrl, {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers: upstreamHeaders,
  });

  if (!upstream.ok && upstream.status !== 206) {
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: {
        'Access-Control-Allow-Origin': origin,
      },
    });
  }

  const responseHeaders = new Headers();
  const rawContentType = (upstream.headers.get('Content-Type') || '').toLowerCase();

  let normalizedMime = fallbackMime;
  if (rawContentType.includes('flac')) {
    normalizedMime = 'audio/flac';
  } else if (
    rawContentType &&
    rawContentType !== 'application/octet-stream' &&
    rawContentType !== 'binary/octet-stream'
  ) {
    normalizedMime = rawContentType;
  }

  responseHeaders.set('Content-Type', normalizedMime);

  const contentLength = upstream.headers.get('Content-Length');
  if (contentLength) {
    responseHeaders.set('Content-Length', contentLength);
  }

  const contentRange = upstream.headers.get('Content-Range');
  if (contentRange) {
    responseHeaders.set('Content-Range', contentRange);
  }

  responseHeaders.set('Accept-Ranges', 'bytes');
  responseHeaders.set('Access-Control-Allow-Origin', origin);
  responseHeaders.set(
    'Access-Control-Expose-Headers',
    'Content-Length, Content-Range, Accept-Ranges, Content-Type'
  );
  responseHeaders.set('Cache-Control', 'private, max-age=3600');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
};
