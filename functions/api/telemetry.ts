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
}

const KEY_PREFIX = 'evt:';

export async function appendTelemetryEvent(
  kv: KVNamespace | undefined,
  event: Omit<TelemetryEvent, 'id' | 'timestamp'> & { timestamp?: string }
): Promise<void> {
  if (!kv) return;
  try {
    const now = Date.now();
    const revTs = String(9999999999999 - now).padStart(13, '0');
    const rand = Math.random().toString(36).slice(2, 7);
    const id = `${now}-${rand}`;
    const key = `${KEY_PREFIX}${revTs}:${rand}`;
    const entry: TelemetryEvent = {
      ...event,
      id,
      timestamp: event.timestamp || new Date(now).toISOString(),
    };
    await kv.put(key, JSON.stringify(entry), {
      expirationTtl: 60 * 60 * 24 * 7,
    });
  } catch {
    // Never fail request if telemetry write fails
  }
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '*';
  const corsHeaders = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method === 'GET') {
    if (!env.MEGHSWARA_TELEMETRY) {
      return new Response(
        JSON.stringify({ ok: false, error: 'MEGHSWARA_TELEMETRY KV binding not found', events: [] }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const listed = await env.MEGHSWARA_TELEMETRY.list({ prefix: KEY_PREFIX, limit: 60 });
    const events: TelemetryEvent[] = [];
    await Promise.all(
      listed.keys.map(async (k) => {
        const raw = await env.MEGHSWARA_TELEMETRY!.get(k.name);
        if (raw) {
          try {
            events.push(JSON.parse(raw) as TelemetryEvent);
          } catch {
            // ignore malformed
          }
        }
      })
    );
    events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return new Response(
      JSON.stringify({ ok: true, count: events.length, events }, null, 2),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (request.method === 'DELETE') {
    if (env.MEGHSWARA_TELEMETRY) {
      const listed = await env.MEGHSWARA_TELEMETRY.list({ prefix: KEY_PREFIX, limit: 200 });
      await Promise.all(listed.keys.map((k) => env.MEGHSWARA_TELEMETRY!.delete(k.name)));
    }
    return new Response(
      JSON.stringify({ ok: true, cleared: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (request.method === 'POST') {
    try {
      const payload = (await request.json()) as Partial<TelemetryEvent>;
      await appendTelemetryEvent(env.MEGHSWARA_TELEMETRY, {
        source: payload.source || 'client',
        level: payload.level || 'error',
        category: payload.category || 'client-error',
        message: payload.message || 'Unknown error',
        device: {
          userAgent: request.headers.get('User-Agent') || undefined,
          ...payload.device,
        },
        track: payload.track,
        details: payload.details,
      });
      return new Response(
        JSON.stringify({ ok: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'Invalid JSON' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }

  return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
};
