const STORAGE_CLIENT_ID_KEY = 'aetherhifi_google_client_id';
const STORAGE_TOKEN_KEY = 'aetherhifi_google_access_token';
const STORAGE_TOKEN_EXPIRY_KEY = 'aetherhifi_google_token_expiry';
const STORAGE_ROOT_FOLDER_KEY = 'aetherhifi_drive_root_folder';
const STORAGE_HAS_AUTHORIZED_KEY = 'aetherhifi_has_authorized_oauth';

export interface DriveRootFolderConfig {
  id: string;
  name: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            hint?: string;
            callback: (response: {
              access_token?: string;
              expires_in?: number;
              error?: string;
            }) => void;
          }) => {
            requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
          };
        };
      };
    };
  }
}

let currentAccessToken: string | null = null;
let refreshTimerId: ReturnType<typeof setTimeout> | null = null;
let pendingSilentRefresh: Promise<string | null> | null = null;
const authListeners = new Set<(token: string | null) => void>();

const DEFAULT_ENV_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

export function getSavedClientId(): string {
  return localStorage.getItem(STORAGE_CLIENT_ID_KEY) || DEFAULT_ENV_CLIENT_ID;
}

export function setSavedClientId(clientId: string): void {
  localStorage.setItem(STORAGE_CLIENT_ID_KEY, clientId.trim());
}

export function getSavedRootFolder(): DriveRootFolderConfig | null {
  const raw = localStorage.getItem(STORAGE_ROOT_FOLDER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DriveRootFolderConfig;
  } catch {
    return null;
  }
}

export function setSavedRootFolder(folder: DriveRootFolderConfig | null): void {
  if (!folder) {
    localStorage.removeItem(STORAGE_ROOT_FOLDER_KEY);
  } else {
    localStorage.setItem(STORAGE_ROOT_FOLDER_KEY, JSON.stringify(folder));
  }
}

export function getTokenExpiryTimestamp(): number {
  return Number(
    sessionStorage.getItem(STORAGE_TOKEN_EXPIRY_KEY) ||
      localStorage.getItem(STORAGE_TOKEN_EXPIRY_KEY) ||
      '0'
  );
}

export function getAccessToken(): string | null {
  const expiry = getTokenExpiryTimestamp();
  if (currentAccessToken && expiry > Date.now() + 15_000) {
    return currentAccessToken;
  }
  const stored =
    sessionStorage.getItem(STORAGE_TOKEN_KEY) || localStorage.getItem(STORAGE_TOKEN_KEY);
  if (stored && expiry > Date.now() + 15_000) {
    currentAccessToken = stored;
    return stored;
  }
  currentAccessToken = null;
  return null;
}

function scheduleSilentTokenRefresh(expiresInSeconds: number): void {
  if (refreshTimerId) {
    clearTimeout(refreshTimerId);
    refreshTimerId = null;
  }
  // Refresh 5 minutes before token expires (minimum 60 seconds from now)
  const refreshDelayMs = Math.max(60_000, (expiresInSeconds - 300) * 1000);
  refreshTimerId = setTimeout(() => {
    trySilentTokenRefresh().catch(() => {
      // Silent refresh requires user interaction if third-party cookies are blocked
    });
  }, refreshDelayMs);
}

export function setManualAccessToken(token: string, expiresInSeconds = 3600): void {
  const clean = token.trim();
  currentAccessToken = clean;
  const expiry = Date.now() + expiresInSeconds * 1000;
  sessionStorage.setItem(STORAGE_TOKEN_KEY, clean);
  sessionStorage.setItem(STORAGE_TOKEN_EXPIRY_KEY, String(expiry));
  localStorage.setItem(STORAGE_TOKEN_KEY, clean);
  localStorage.setItem(STORAGE_TOKEN_EXPIRY_KEY, String(expiry));
  localStorage.setItem(STORAGE_HAS_AUTHORIZED_KEY, 'true');
  if (typeof document !== 'undefined') {
    const secureFlag = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `meghswara_token=${encodeURIComponent(
      clean
    )}; path=/; max-age=${expiresInSeconds}; SameSite=Lax${secureFlag}`;
  }
  syncTokenWithServiceWorker(clean);
  scheduleSilentTokenRefresh(expiresInSeconds);
  authListeners.forEach((cb) => cb(clean));
}

export function clearAccessToken(): void {
  currentAccessToken = null;
  if (refreshTimerId) {
    clearTimeout(refreshTimerId);
    refreshTimerId = null;
  }
  sessionStorage.removeItem(STORAGE_TOKEN_KEY);
  sessionStorage.removeItem(STORAGE_TOKEN_EXPIRY_KEY);
  localStorage.removeItem(STORAGE_TOKEN_KEY);
  localStorage.removeItem(STORAGE_TOKEN_EXPIRY_KEY);
  localStorage.removeItem(STORAGE_HAS_AUTHORIZED_KEY);
  if (typeof document !== 'undefined') {
    document.cookie = 'meghswara_token=; path=/; max-age=0; SameSite=Lax';
  }
  syncTokenWithServiceWorker(null);
  authListeners.forEach((cb) => cb(null));
}

export function subscribeAuthChanges(cb: (token: string | null) => void): () => void {
  authListeners.add(cb);
  return () => {
    authListeners.delete(cb);
  };
}

/**
 * Attempts a zero-prompt silent token renewal via Google Identity Services if the user
 * has previously authorized MeghSwara on this browser.
 */
export function trySilentTokenRefresh(): Promise<string | null> {
  if (pendingSilentRefresh) return pendingSilentRefresh;

  const clientId = getSavedClientId().trim();
  const hasAuthorizedBefore = localStorage.getItem(STORAGE_HAS_AUTHORIZED_KEY) === 'true';
  if (!clientId || !hasAuthorizedBefore || typeof window === 'undefined') {
    return Promise.resolve(null);
  }

  pendingSilentRefresh = new Promise<string | null>((resolve) => {
    if (!window.google?.accounts?.oauth2) {
      resolve(null);
      return;
    }

    const timeout = setTimeout(() => resolve(null), 6000);
    try {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope:
          'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file',
        callback: (response) => {
          clearTimeout(timeout);
          if (response.error || !response.access_token) {
            resolve(null);
            return;
          }
          setManualAccessToken(response.access_token, response.expires_in || 3600);
          resolve(response.access_token);
        },
      });
      tokenClient.requestAccessToken({ prompt: 'none' });
    } catch {
      clearTimeout(timeout);
      resolve(null);
    }
  }).finally(() => {
    pendingSilentRefresh = null;
  });

  return pendingSilentRefresh;
}

export async function ensureFreshAccessToken(): Promise<string | null> {
  const existing = getAccessToken();
  const expiry = getTokenExpiryTimestamp();
  // If valid and has more than 3 minutes remaining, return immediately
  if (existing && expiry > Date.now() + 180_000) {
    return existing;
  }
  const refreshed = await trySilentTokenRefresh();
  return refreshed || existing;
}

export async function registerStreamServiceWorker(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  // Schedule auto-refresh if an active token is already in storage
  const existingToken = getAccessToken();
  if (existingToken) {
    const remainingSec = Math.max(60, Math.floor((getTokenExpiryTimestamp() - Date.now()) / 1000));
    scheduleSilentTokenRefresh(remainingSec);
  } else if (localStorage.getItem(STORAGE_HAS_AUTHORIZED_KEY) === 'true') {
    // Wait briefly for GIS script to load, then attempt silent restore
    setTimeout(() => {
      trySilentTokenRefresh().catch(() => {});
    }, 1500);
  }

  // Also check token freshness when user returns to the tab after laptop sleep / mobile switch
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        const expiry = getTokenExpiryTimestamp();
        if (
          localStorage.getItem(STORAGE_HAS_AUTHORIZED_KEY) === 'true' &&
          expiry < Date.now() + 300_000
        ) {
          trySilentTokenRefresh().catch(() => {});
        }
      }
    });
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw-stream.js', {
      scope: '/',
    });

    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'REQUEST_ACCESS_TOKEN') {
        const token = getAccessToken();
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ token });
        }
      }
    });

    await navigator.serviceWorker.ready;
    const token = getAccessToken();
    if (token) {
      syncTokenWithServiceWorker(token, registration.active);
    }
  } catch (err) {
    console.warn('Service worker registration warning:', err);
  }
}

export function syncTokenWithServiceWorker(
  token: string | null,
  targetWorker?: ServiceWorker | null
): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }
  const worker = targetWorker || navigator.serviceWorker.controller;
  if (worker) {
    worker.postMessage({
      type: 'SET_ACCESS_TOKEN',
      token,
    });
  }
}

export function signInWithGoogleOAuth(clientId?: string): Promise<string> {
  const activeClientId = (clientId || getSavedClientId()).trim();
  if (!activeClientId) {
    return Promise.reject(new Error('Please configure your Google OAuth Client ID first.'));
  }

  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      reject(
        new Error(
          'Google Identity Services script has not loaded yet. Check your internet connection or ad-blocker.'
        )
      );
      return;
    }

    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: activeClientId,
      scope:
        'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file',
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error || 'Failed to obtain access token'));
          return;
        }
        setManualAccessToken(response.access_token, response.expires_in || 3600);
        resolve(response.access_token);
      },
    });

    tokenClient.requestAccessToken({ prompt: '' });
  });
}

export function buildDriveStreamUrl(
  fileId: string,
  mimeType = 'audio/flac',
  fileSize?: number
): string {
  const token = getAccessToken();
  const params = new URLSearchParams({ mime: mimeType });
  if (fileSize && fileSize > 0) {
    params.set('size', String(fileSize));
  }
  if (token) {
    params.set('token', token);
  }
  return `/drive-stream/${encodeURIComponent(fileId)}?${params.toString()}`;
}
