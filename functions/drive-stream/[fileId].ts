/**
 * Cloudflare Pages Edge Function for /drive-stream/:fileId
 * Ensures Android & iOS mobile media players (which may bypass Service Workers on <audio> Range requests)
 * stream raw lossless FLAC bytes with HTTP 206 Partial Content and normalized 'audio/flac' MIME type.
 */

interface Env {}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, params } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Authorization, Content-Type',
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
  const queryToken = url.searchParams.get('token');
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim() || queryToken;

  if (!token) {
    return new Response('Missing Google Drive OAuth token', { status: 401 });
  }

  const upstreamHeaders = new Headers();
  upstreamHeaders.set('Authorization', `Bearer ${token}`);

  const rangeHeader = request.headers.get('Range');
  if (rangeHeader) {
    upstreamHeaders.set('Range', rangeHeader);
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
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  const responseHeaders = new Headers();
  const rawContentType = (upstream.headers.get('Content-Type') || '').toLowerCase();

  // Mobile Android/iOS browsers reject 'application/x-flac' or 'application/octet-stream' on <audio>;
  // normalize to standard 'audio/flac' (or fallbackMime).
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
  responseHeaders.set('Access-Control-Allow-Origin', '*');
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
