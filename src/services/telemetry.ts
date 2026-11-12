import type { Track } from '../types/music';

export interface ClientTelemetryInput {
  level?: 'error' | 'warn' | 'info';
  category: string;
  message: string;
  track?: Track | null;
  details?: Record<string, unknown>;
}

function getDeviceSnapshot() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {};
  }
  const nav = navigator as Navigator & {
    connection?: { effectiveType?: string; downlink?: number };
  };
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    isStandalonePwa:
      window.matchMedia?.('(display-mode: standalone)').matches ||
      Boolean((navigator as { standalone?: boolean }).standalone),
    swControlled: Boolean(navigator.serviceWorker?.controller),
    connection: nav.connection?.effectiveType
      ? `${nav.connection.effectiveType} (${nav.connection.downlink ?? '?'} Mbps)`
      : undefined,
  };
}

export function redactTokenFromUrl(url: string): string {
  if (!url) return '';
  return url.replace(/([?&]token=)[^&]+/gi, '$1REDACTED');
}

export function reportTelemetry(input: ClientTelemetryInput): void {
  if (typeof window === 'undefined') return;

  const body = JSON.stringify({
    source: 'client',
    level: input.level || 'error',
    category: input.category,
    message: input.message,
    device: getDeviceSnapshot(),
    track: input.track
      ? {
          id: input.track.id,
          title: input.track.title,
          format: input.track.format,
          mimeType: input.track.mimeType,
          size: input.track.size,
        }
      : undefined,
    details: input.details,
  });

  try {
    fetch('/api/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // ignore network failure
    });
  } catch {
    // ignore
  }
}

let globalListenersAttached = false;

export function initGlobalErrorTelemetry(): void {
  if (globalListenersAttached || typeof window === 'undefined') return;
  globalListenersAttached = true;

  window.addEventListener('error', (event) => {
    reportTelemetry({
      level: 'error',
      category: 'window-error',
      message: event.message || 'Uncaught window error',
      details: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error instanceof Error ? event.error.stack : undefined,
      },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
        ? reason
        : JSON.stringify(reason);
    reportTelemetry({
      level: 'error',
      category: 'unhandled-rejection',
      message: message || 'Unhandled Promise Rejection',
      details: {
        stack: reason instanceof Error ? reason.stack : undefined,
      },
    });
  });
}
