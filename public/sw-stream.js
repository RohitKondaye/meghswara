/**
 * Service Worker Stream Proxy for Google Drive Lossless Audio
 * Uses Adaptive HTTP 206 Packet Streaming:
 * - First packet (bytes=0-...): 768 KB for instant mobile & desktop track startup
 * - Rolling packets: 2 MB chunks for smooth continuous playback & instant seeking
 */

let accessToken = null;
const INITIAL_PACKET_BYTES = 786432; // 768 KB
const ROLLING_PACKET_BYTES = 2097152; // 2 MB

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SET_ACCESS_TOKEN') {
    accessToken = event.data.token;
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ ok: true });
    }
  } else if (event.data.type === 'PING_SW') {
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ ok: true, hasToken: Boolean(accessToken) });
    }
  }
});

async function resolveAccessToken() {
  if (accessToken) return accessToken;
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clientList) {
    const token = await new Promise((resolve) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => resolve(null), 1200);
      channel.port1.onmessage = (evt) => {
        clearTimeout(timeout);
        resolve(evt.data?.token || null);
      };
      client.postMessage({ type: 'REQUEST_ACCESS_TOKEN' }, [channel.port2]);
    });
    if (token) {
      accessToken = token;
      return token;
    }
  }
  return null;
}

function buildPacketRangeHeader(incomingRange, knownFileSize) {
  if (!incomingRange || !incomingRange.startsWith('bytes=')) {
    const end =
      knownFileSize > 0
        ? Math.min(knownFileSize - 1, INITIAL_PACKET_BYTES - 1)
        : INITIAL_PACKET_BYTES - 1;
    return `bytes=0-${end}`;
  }

  const spec = incomingRange.replace('bytes=', '').trim();
  const parts = spec.split('-');
  const start = parseInt(parts[0], 10);

  if (isNaN(start) || start < 0) {
    return incomingRange;
  }

  if (parts[1] && parts[1].trim().length > 0) {
    const requestedEnd = parseInt(parts[1], 10);
    if (!isNaN(requestedEnd) && requestedEnd >= start) {
      const maxSpan = start === 0 ? INITIAL_PACKET_BYTES : ROLLING_PACKET_BYTES;
      const cappedEnd = Math.min(requestedEnd, start + maxSpan - 1);
      return `bytes=${start}-${
        knownFileSize > 0 ? Math.min(knownFileSize - 1, cappedEnd) : cappedEnd
      }`;
    }
  }

  const packetSize = start === 0 ? INITIAL_PACKET_BYTES : ROLLING_PACKET_BYTES;
  let targetEnd = start + packetSize - 1;
  if (knownFileSize > 0) {
    targetEnd = Math.min(knownFileSize - 1, targetEnd);
  }
  return `bytes=${start}-${targetEnd}`;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith('/drive-stream/')) {
    return;
  }

  const fileId = decodeURIComponent(url.pathname.replace('/drive-stream/', '').trim());
  const fallbackMime = url.searchParams.get('mime') || 'audio/flac';
  const queryToken = url.searchParams.get('token');
  const knownFileSize = Number(url.searchParams.get('size') || '0');

  event.respondWith(
    handleDriveStream(event.request, fileId, fallbackMime, queryToken, knownFileSize)
  );
});

async function handleDriveStream(
  request,
  fileId,
  fallbackMime,
  queryToken,
  knownFileSize
) {
  const token = queryToken || (await resolveAccessToken());
  if (!token) {
    return fetch(request);
  }

  const headers = new Headers();
  headers.set('Authorization', `Bearer ${token}`);

  const rangeHeader = request.headers.get('Range');
  headers.set('Range', buildPacketRangeHeader(rangeHeader, knownFileSize));

  const driveUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    fileId
  )}?alt=media&supportsAllDrives=true`;

  try {
    const upstream = await fetch(driveUrl, {
      method: 'GET',
      headers,
      mode: 'cors',
      credentials: 'omit',
    });

    if (!upstream.ok && upstream.status !== 206) {
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
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
    responseHeaders.set('Cache-Control', 'private, max-age=3600');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch {
    return fetch(request);
  }
}
