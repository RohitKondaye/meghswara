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

const KV_KEY = 'recent_telemetry_events_v1';
const MAX_EVENTS = 100;

export async function appendTelemetryEvent(
  kv: KVNamespace | undefined,
  event: Omit<TelemetryEvent, 'id' | 'timestamp'> & { timestamp?: string }
): Promise<void> {
  if (!kv) return;
  try {
    const existingRaw = await kv.get(KV_KEY);
    const list: TelemetryEvent[] = existingRaw ? JSON.parse(existingRaw) : [];
    const entry: TelemetryEvent = {
      ...event,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: event.timestamp || new Date().toISOString(),
    };
    list.unshift(entry);
    if (list.length > MAX_EVENTS) {
      list.length = MAX_EVENTS;
    }
    await kv.put(KV_KEY, JSON.stringify(list), { expirationTtl: 60 * 60 * 24 * 7 });
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
    const raw = await env.MEGHSWARA_TELEMETRY.get(KV_KEY);
    const events: TelemetryEvent[] = raw ? JSON.parse(raw) : [];
    return new Response(
      JSON.stringify({ ok: true, count: events.length, events }, null, 2),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (request.method === 'DELETE') {
    if (env.MEGHSWARA_TELEMETRY) {
      await env.MEGHSWARA_TELEMETRY.delete(KV_KEY);
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
