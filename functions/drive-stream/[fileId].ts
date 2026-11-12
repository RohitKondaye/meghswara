/**
 * Cloudflare Pages Edge Function for /drive-stream/:fileId and /api/stream/:fileId
 * Streams raw lossless FLAC audio directly from Google Drive using HTTP/2 ReadableStream frames
 * with HTTP 206 Partial Content and normalized 'audio/flac' MIME type.
 */

import { appendTelemetryEvent } from '../api/telemetry';

interface Env {
  MEGHSWARA_TELEMETRY?: KVNamespace;
}

function parseCookieToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)meghswara_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, params, env } = context;
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

  const authHeader = request.headers.get('Authorization');
  const cookieToken = parseCookieToken(request.headers.get('Cookie'));
  const queryToken = url.searchParams.get('token');
  const token =
    authHeader?.replace(/^Bearer\s+/i, '').trim() || cookieToken || queryToken;

  if (!token) {
    context.waitUntil(
      appendTelemetryEvent(env.MEGHSWARA_TELEMETRY, {
        source: 'edge-stream',
        level: 'error',
        category: 'edge-missing-token',
        message: `Missing Google Drive OAuth token on stream ${fileId}`,
        device: {
          userAgent: request.headers.get('User-Agent') || undefined,
        },
        track: { id: fileId, mimeType: fallbackMime },
        details: {
          hasAuthHeader: Boolean(authHeader),
          hasCookie: Boolean(cookieToken),
          hasQueryToken: Boolean(queryToken),
          range: request.headers.get('Range'),
        },
      })
    );
    return new Response('Missing Google Drive OAuth token', { status: 401 });
  }

  const upstreamHeaders = new Headers();
  upstreamHeaders.set('Authorization', `Bearer ${token}`);

  const incomingRange = request.headers.get('Range');
  if (incomingRange) {
    upstreamHeaders.set('Range', incomingRange);
  } else {
    upstreamHeaders.set('Range', 'bytes=0-');
  }

  const driveUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    fileId
  )}?alt=media&supportsAllDrives=true`;

  const upstream = await fetch(driveUrl, {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers: upstreamHeaders,
  });

  if (!upstream.ok && upstream.status !== 206) {
    const errBody = await upstream.text().catch(() => '');
    context.waitUntil(
      appendTelemetryEvent(env.MEGHSWARA_TELEMETRY, {
        source: 'edge-stream',
        level: 'error',
        category: `drive-upstream-${upstream.status}`,
        message: `Google Drive upstream returned HTTP ${upstream.status} for file ${fileId}`,
        device: {
          userAgent: request.headers.get('User-Agent') || undefined,
        },
        track: { id: fileId, mimeType: fallbackMime },
        details: {
          status: upstream.status,
          statusText: upstream.statusText,
          rangeSent: upstreamHeaders.get('Range'),
          tokenSource: authHeader ? 'header' : cookieToken ? 'cookie' : 'query',
          upstreamErrorBody: errBody.slice(0, 500),
        },
      })
    );
    return new Response(errBody, {
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
  responseHeaders.set('Cache-Control', 'no-store');

  if (!incomingRange || incomingRange === 'bytes=0-') {
    context.waitUntil(
      appendTelemetryEvent(env.MEGHSWARA_TELEMETRY, {
        source: 'edge-stream',
        level: 'info',
        category: 'edge-stream-206-ok',
        message: `Streaming 206 Partial Content for ${fileId} (${normalizedMime})`,
        device: {
          userAgent: request.headers.get('User-Agent') || undefined,
        },
        track: { id: fileId, mimeType: normalizedMime },
        details: {
          upstreamStatus: upstream.status,
          rawContentType,
          normalizedMime,
          contentRange,
          contentLength,
          incomingRange: incomingRange || '(none)',
        },
      })
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
};
