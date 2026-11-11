const STORAGE_CLIENT_ID_KEY = 'aetherhifi_google_client_id';
const STORAGE_TOKEN_KEY = 'aetherhifi_google_access_token';
const STORAGE_TOKEN_EXPIRY_KEY = 'aetherhifi_google_token_expiry';
const STORAGE_ROOT_FOLDER_KEY = 'aetherhifi_drive_root_folder';

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

export function getAccessToken(): string | null {
  if (currentAccessToken) return currentAccessToken;
  const stored = sessionStorage.getItem(STORAGE_TOKEN_KEY) || localStorage.getItem(STORAGE_TOKEN_KEY);
  const expiry = Number(
    sessionStorage.getItem(STORAGE_TOKEN_EXPIRY_KEY) ||
      localStorage.getItem(STORAGE_TOKEN_EXPIRY_KEY) ||
      '0'
  );
  if (stored && expiry > Date.now() + 30_000) {
    currentAccessToken = stored;
    return stored;
  }
  return null;
}

export function setManualAccessToken(token: string, expiresInSeconds = 3600): void {
  const clean = token.trim();
  currentAccessToken = clean;
  const expiry = Date.now() + expiresInSeconds * 1000;
  sessionStorage.setItem(STORAGE_TOKEN_KEY, clean);
  sessionStorage.setItem(STORAGE_TOKEN_EXPIRY_KEY, String(expiry));
  localStorage.setItem(STORAGE_TOKEN_KEY, clean);
  localStorage.setItem(STORAGE_TOKEN_EXPIRY_KEY, String(expiry));
  syncTokenWithServiceWorker(clean);
  authListeners.forEach((cb) => cb(clean));
}

export function clearAccessToken(): void {
  currentAccessToken = null;
  sessionStorage.removeItem(STORAGE_TOKEN_KEY);
  sessionStorage.removeItem(STORAGE_TOKEN_EXPIRY_KEY);
  localStorage.removeItem(STORAGE_TOKEN_KEY);
  localStorage.removeItem(STORAGE_TOKEN_EXPIRY_KEY);
  syncTokenWithServiceWorker(null);
  authListeners.forEach((cb) => cb(null));
}

export function subscribeAuthChanges(cb: (token: string | null) => void): () => void {
  authListeners.add(cb);
  return () => {
    authListeners.delete(cb);
  };
}

export async function registerStreamServiceWorker(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
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

export function buildDriveStreamUrl(fileId: string, mimeType = 'audio/flac'): string {
  const token = getAccessToken();
  const params = new URLSearchParams({ mime: mimeType });
  if (token) {
    params.set('token', token);
  }
  return `/drive-stream/${encodeURIComponent(fileId)}?${params.toString()}`;
}
