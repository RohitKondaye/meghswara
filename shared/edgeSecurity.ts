/**
 * Shared security helpers for Cloudflare Pages Functions.
 * Kept outside /functions so it is bundled as a module rather than routed.
 */

const EXACT_ALLOWED_ORIGINS = new Set([
  'https://meghswara.pages.dev',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
]);

// Cloudflare Pages preview deployments, e.g. https://6d221822.meghswara.pages.dev
const PREVIEW_ORIGIN_PATTERN = /^https:\/\/[a-z0-9-]+\.meghswara\.pages\.dev$/;

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return EXACT_ALLOWED_ORIGINS.has(origin) || PREVIEW_ORIGIN_PATTERN.test(origin);
}

/**
 * Returns CORS headers that only reflect allowlisted origins.
 * Unknown origins get no Access-Control-Allow-Origin header, so browsers block the response.
 */
export function buildCorsHeaders(
  request: Request,
  extra: Record<string, string> = {}
): Record<string, string> {
  const origin = request.headers.get('Origin');
  const headers: Record<string, string> = { Vary: 'Origin', ...extra };
  if (isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin as string;
  }
  return headers;
}

/**
 * True when the request clearly comes from a different site
 * (Sec-Fetch-Site is sent by all modern browsers, including Android Chrome).
 */
export function isCrossSiteRequest(request: Request): boolean {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site === 'cross-site') return true;
  const origin = request.headers.get('Origin');
  return Boolean(origin) && !isAllowedOrigin(origin);
}

const GOOGLE_TOKEN_PATTERN = /ya29\.[A-Za-z0-9._\-]+/g;
const QUERY_TOKEN_PATTERN = /([?&]token=)[^&\s"']+/gi;
const BEARER_PATTERN = /(Bearer\s+)[A-Za-z0-9._\-]+/gi;

export function scrubString(value: string): string {
  return value
    .replace(GOOGLE_TOKEN_PATTERN, 'ya29.REDACTED')
    .replace(QUERY_TOKEN_PATTERN, '$1REDACTED')
    .replace(BEARER_PATTERN, '$1REDACTED');
}

/** Deep-scrubs OAuth tokens from any string inside an object/array. */
export function scrubSecrets<T>(input: T, depth = 0): T {
  if (depth > 6 || input === null || input === undefined) return input;
  if (typeof input === 'string') return scrubString(input) as unknown as T;
  if (Array.isArray(input)) {
    return input.slice(0, 50).map((v) => scrubSecrets(v, depth + 1)) as unknown as T;
  }
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>).slice(0, 50)) {
      out[k] = scrubSecrets(v, depth + 1);
    }
    return out as T;
  }
  return input;
}

/** Constant-time string comparison to avoid timing leaks on the telemetry read key. */
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}
