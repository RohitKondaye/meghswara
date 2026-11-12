import {
  buildCorsHeaders,
  isCrossSiteRequest,
  safeEqual,
  scrubSecrets,
  scrubString,
} from '../../shared/edgeSecurity';

export interface TelemetryEvent {
  id: string;
  timestamp: string;
  source: 'client' | 'edge-stream';
  level: 'error' | 'warn' | 'info';
  category: string;
  message: string;
  device?: {
    userAgent?: string;
    platform?: string;
    viewport?: string;
    isStandalonePwa?: boolean;
    swControlled?: boolean;
    connection?: string;
  };
  track?: {
    id?: string;
    title?: string;
    format?: string;
    mimeType?: string;
    size?: number;
  };
  details?: Record<string, unknown>;
}

interface Env {
  MEGHSWARA_TELEMETRY?: KVNamespace;
  TELEMETRY_READ_KEY?: string;
}

const KEY_PREFIX = 'evt:';
const MAX_POST_BYTES = 8 * 1024;

function clip(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export async function appendTelemetryEvent(
  kv: KVNamespace | undefined,
  event: Omit<TelemetryEvent, 'id' | 'timestamp'> & { timestamp?: string }
): Promise<void> {
  if (!kv) return;
  try {
    const now = Date.now();
    const revTs = String(9999999999999 - now).padStart(13, '0');
    const rand = Math.random().toString(36).slice(2, 7);
    const entry: TelemetryEvent = scrubSecrets({
      ...event,
      message: clip(event.message, 500) || 'Unknown error',
      category: clip(event.category, 80) || 'unknown',
      id: `${now}-${rand}`,
      timestamp: new Date(now).toISOString(),
    });
    await kv.put(`${KEY_PREFIX}${revTs}:${rand}`, JSON.stringify(entry), {
      expirationTtl: 60 * 60 * 24 * 7,
    });
  } catch {
    // Never fail a request because telemetry failed
  }
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

function hasReadAccess(request: Request, env: Env): boolean {
  const provided = request.headers.get('X-Telemetry-Key') || '';
  return Boolean(env.TELEMETRY_READ_KEY) && safeEqual(provided, env.TELEMETRY_READ_KEY as string);
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const cors = buildCorsHeaders(request, {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  // Reading or wiping logs requires the private diagnostic key (never shipped to the browser)
  if (request.method === 'GET' || request.method === 'DELETE') {
    if (!hasReadAccess(request, env)) {
      return json({ ok: false, error: 'Unauthorized' }, 401, { 'Cache-Control': 'no-store' });
    }
    if (!env.MEGHSWARA_TELEMETRY) {
      return json({ ok: false, error: 'KV binding missing', events: [] }, 500, {
        'Cache-Control': 'no-store',
      });
    }

    if (request.method === 'DELETE') {
      const listed = await env.MEGHSWARA_TELEMETRY.list({ prefix: KEY_PREFIX, limit: 500 });
      await Promise.all(listed.keys.map((k) => env.MEGHSWARA_TELEMETRY!.delete(k.name)));
      return json({ ok: true, cleared: listed.keys.length }, 200, { 'Cache-Control': 'no-store' });
    }

    const listed = await env.MEGHSWARA_TELEMETRY.list({ prefix: KEY_PREFIX, limit: 60 });
    const events: TelemetryEvent[] = [];
    await Promise.all(
      listed.keys.map(async (k) => {
        const raw = await env.MEGHSWARA_TELEMETRY!.get(k.name);
        if (!raw) return;
        try {
          events.push(JSON.parse(raw) as TelemetryEvent);
        } catch {
          // skip malformed entries
        }
      })
    );
    events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return json({ ok: true, count: events.length, events }, 200, { 'Cache-Control': 'no-store' });
  }

  if (request.method === 'POST') {
    // Only accept reports from MeghSwara itself
    if (isCrossSiteRequest(request)) {
      return json({ ok: false, error: 'Forbidden origin' }, 403, cors);
    }

    const declaredLength = Number(request.headers.get('Content-Length') || '0');
    if (declaredLength > MAX_POST_BYTES) {
      return json({ ok: false, error: 'Payload too large' }, 413, cors);
    }

    const text = await request.text();
    if (text.length > MAX_POST_BYTES) {
      return json({ ok: false, error: 'Payload too large' }, 413, cors);
    }

    try {
      const payload = JSON.parse(text) as Partial<TelemetryEvent>;
      const level =
        payload.level === 'warn' || payload.level === 'info' ? payload.level : 'error';
      await appendTelemetryEvent(env.MEGHSWARA_TELEMETRY, {
        source: 'client',
        level,
        category: clip(payload.category, 80) || 'client-error',
        message: scrubString(clip(payload.message, 500) || 'Unknown error'),
        device: {
          ...payload.device,
          userAgent: clip(request.headers.get('User-Agent'), 300),
        },
        track: payload.track,
        details: payload.details,
      });
      return json({ ok: true }, 200, cors);
    } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400, cors);
    }
  }

  return new Response('Method Not Allowed', { status: 405, headers: cors });
};
