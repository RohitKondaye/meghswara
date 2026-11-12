/**
 * Cloudflare Pages Edge Function for /drive-stream/:fileId and /api/stream/:fileId
 * Streams raw lossless audio directly from Google Drive (HTTP 206 Partial Content)
 * with a normalized 'audio/flac' MIME type for mobile browsers.
 *
 * Auth order: Authorization header -> meghswara_token cookie (SameSite=Strict) -> ?token= fallback.
 */

import { appendTelemetryEvent } from '../api/telemetry';
import { buildCorsHeaders, isCrossSiteRequest } from '../../shared/edgeSecurity';

interface Env {
  MEGHSWARA_TELEMETRY?: KVNamespace;
}

// Google Drive file IDs are URL-safe base64-ish strings
const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/;

function parseCookieToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)meghswara_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, params, env } = context;
  const cors = buildCorsHeaders(request, {
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Authorization, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
  });

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: cors });
  }

  // Block other websites from embedding/proxying MeghSwara streams
  if (isCrossSiteRequest(request)) {
    return new Response('Forbidden', { status: 403, headers: cors });
  }

  const rawFileId = params.fileId;
  const fileId = Array.isArray(rawFileId) ? rawFileId[0] : rawFileId;
  if (!fileId || !FILE_ID_PATTERN.test(fileId)) {
    return new Response('Invalid Google Drive fileId', { status: 400, headers: cors });
  }

  const url = new URL(request.url);
  const requestedMime = url.searchParams.get('mime') || 'audio/flac';
  const fallbackMime = /^audio\/[a-z0-9.+-]+$/i.test(requestedMime) ? requestedMime : 'audio/flac';

  const authHeader = request.headers.get('Authorization');
  const cookieToken = parseCookieToken(request.headers.get('Cookie'));
  const queryToken = url.searchParams.get('token');
  const token =
    authHeader?.replace(/^Bearer\s+/i, '').trim() || cookieToken || queryToken;
  const tokenSource = authHeader ? 'header' : cookieToken ? 'cookie' : queryToken ? 'query' : 'none';

  if (!token) {
    context.waitUntil(
      appendTelemetryEvent(env.MEGHSWARA_TELEMETRY, {
        source: 'edge-stream',
        level: 'error',
        category: 'edge-missing-token',
        message: `Missing Google Drive OAuth token on stream ${fileId}`,
        device: { userAgent: request.headers.get('User-Agent') || undefined },
        track: { id: fileId, mimeType: fallbackMime },
        details: { range: request.headers.get('Range') },
      })
    );
    return new Response('Missing Google Drive OAuth token', { status: 401, headers: cors });
  }

  const upstreamHeaders = new Headers();
  upstreamHeaders.set('Authorization', `Bearer ${token}`);
  const incomingRange = request.headers.get('Range');
  upstreamHeaders.set('Range', incomingRange || 'bytes=0-');

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
        device: { userAgent: request.headers.get('User-Agent') || undefined },
        track: { id: fileId, mimeType: fallbackMime },
        details: {
          status: upstream.status,
          rangeSent: upstreamHeaders.get('Range'),
          tokenSource,
          upstreamErrorBody: errBody.slice(0, 500),
        },
      })
    );
    // Do not echo Google's raw error body back to the client
    return new Response(`Upstream error ${upstream.status}`, {
      status: upstream.status,
      headers: { ...cors, 'Cache-Control': 'no-store' },
    });
  }

  const responseHeaders = new Headers(cors);
  const rawContentType = (upstream.headers.get('Content-Type') || '').toLowerCase();

  let normalizedMime = fallbackMime;
  if (rawContentType.includes('flac')) {
    normalizedMime = 'audio/flac';
  } else if (rawContentType.startsWith('audio/')) {
    normalizedMime = rawContentType;
  }

  responseHeaders.set('Content-Type', normalizedMime);
  const contentLength = upstream.headers.get('Content-Length');
  if (contentLength) responseHeaders.set('Content-Length', contentLength);
  const contentRange = upstream.headers.get('Content-Range');
  if (contentRange) responseHeaders.set('Content-Range', contentRange);
  responseHeaders.set('Accept-Ranges', 'bytes');
  responseHeaders.set('Cache-Control', 'no-store');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  responseHeaders.set('Referrer-Policy', 'no-referrer');

  if (!incomingRange || incomingRange === 'bytes=0-') {
    context.waitUntil(
      appendTelemetryEvent(env.MEGHSWARA_TELEMETRY, {
        source: 'edge-stream',
        level: 'info',
        category: 'edge-stream-206-ok',
        message: `Streaming ${upstream.status} for ${fileId} (${normalizedMime})`,
        device: { userAgent: request.headers.get('User-Agent') || undefined },
        track: { id: fileId, mimeType: normalizedMime },
        details: {
          upstreamStatus: upstream.status,
          rawContentType,
          contentRange,
          contentLength,
          tokenSource,
        },
      })
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
};
