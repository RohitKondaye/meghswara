/**
 * Service Worker Stream Proxy for Google Drive Lossless Audio
 * Streams HTTP 206 Partial Content directly from Google Drive CDN via ReadableStream frames
 * while normalizing 'application/x-flac' to 'audio/flac' for mobile & desktop browsers.
 */

let accessToken = null;

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

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith('/drive-stream/')) {
    return;
  }

  const fileId = decodeURIComponent(url.pathname.replace('/drive-stream/', '').trim());
  const fallbackMime = url.searchParams.get('mime') || 'audio/flac';
  const queryToken = url.searchParams.get('token');

  event.respondWith(handleDriveStream(event.request, fileId, fallbackMime, queryToken));
});

async function handleDriveStream(request, fileId, fallbackMime, queryToken) {
  const token = queryToken || (await resolveAccessToken());
  if (!token) {
    return fetch(request);
  }

  const headers = new Headers();
  headers.set('Authorization', `Bearer ${token}`);

  const rangeHeader = request.headers.get('Range');
  if (rangeHeader) {
    headers.set('Range', rangeHeader);
  } else {
    headers.set('Range', 'bytes=0-');
  }

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
