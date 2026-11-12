import React, { useEffect, useState } from 'react';
import {
  X,
  HardDrive,
  Folder,
  ChevronRight,
  KeyRound,
  CloudDownload,
  CloudUpload,
  RefreshCw,
  CheckCircle2,
  HelpCircle,
  LogOut,
} from 'lucide-react';
import {
  clearAccessToken,
  getSavedClientId,
  getSavedRootFolder,
  setManualAccessToken,
  setSavedClientId,
  setSavedRootFolder,
  signInWithGoogleOAuth,
  type DriveRootFolderConfig,
} from '../services/googleAuth';
import { listDriveFolders, type DriveFileItem } from '../services/driveApi';
import { PrivacyNotice } from './PrivacyNotice';

interface DriveSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  isConnected: boolean;
  onStartFolderScan: (folder: DriveRootFolderConfig) => Promise<void>;
  onLoadCloudIndex: (folderId?: string) => Promise<void>;
  onSaveCloudIndex: (folderId?: string) => Promise<void>;
  statusMessage: string | null;
}

export const DriveSetupModal: React.FC<DriveSetupModalProps> = ({
  isOpen,
  onClose,
  isConnected,
  onStartFolderScan,
  onLoadCloudIndex,
  onSaveCloudIndex,
  statusMessage,
}) => {
  const [clientId, setClientId] = useState(getSavedClientId());
  const [manualToken, setManualToken] = useState('');
  const [showGuide, setShowGuide] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<DriveRootFolderConfig>(
    getSavedRootFolder() || { id: 'root', name: 'My Drive (Root)' }
  );
  const [browsingParentId, setBrowsingParentId] = useState('root');
  const [breadcrumbs, setBreadcrumbs] = useState<DriveRootFolderConfig[]>([
    { id: 'root', name: 'My Drive' },
  ]);
  const [subfolders, setSubfolders] = useState<DriveFileItem[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageUsedMb, setStorageUsedMb] = useState<string | null>(null);
  const [isPrivacyOpen, setIsPrivacyOpen] = useState(false);

  const refreshStorageEstimate = async () => {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      try {
        const est = await navigator.storage.estimate();
        const mb = ((est.usage || 0) / (1024 * 1024)).toFixed(1);
        setStorageUsedMb(mb);
      } catch {
        // ignore
      }
    }
  };

  useEffect(() => {
    if (isOpen) {
      refreshStorageEstimate();
    }
    if (isOpen && isConnected) {
      loadFolderList(browsingParentId);
    }
  }, [isOpen, isConnected, browsingParentId]);

  if (!isOpen) return null;

  const loadFolderList = async (parentId: string) => {
    setLoadingFolders(true);
    setError(null);
    try {
      const list = await listDriveFolders(parentId);
      setSubfolders(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to list Google Drive folders');
    } finally {
      setLoadingFolders(false);
    }
  };

  const handleOAuthSignIn = async () => {
    setError(null);
    try {
      setSavedClientId(clientId);
      await signInWithGoogleOAuth(clientId);
      await loadFolderList('root');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google OAuth sign-in failed');
    }
  };

  const handleManualTokenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualToken.trim()) return;
    setError(null);
    setManualAccessToken(manualToken.trim(), 3600);
    setManualToken('');
    await loadFolderList('root');
  };

  const handleNavigateIntoFolder = (folder: DriveFileItem) => {
    const nextConfig = { id: folder.id, name: folder.name };
    setSelectedFolder(nextConfig);
    setSavedRootFolder(nextConfig);
    setBreadcrumbs((prev) => [...prev, nextConfig]);
    setBrowsingParentId(folder.id);
  };

  const handleBreadcrumbClick = (index: number) => {
    const target = breadcrumbs[index];
    setBreadcrumbs(breadcrumbs.slice(0, index + 1));
    setSelectedFolder(target);
    setSavedRootFolder(target);
    setBrowsingParentId(target.id);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-zinc-950 border border-zinc-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <HardDrive className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-bold text-zinc-100">
              Google Drive Lossless Library Setup & Cloud Sync
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6 text-sm">
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-950/70 border border-rose-500/40 text-rose-200 text-xs">
              {error}
            </div>
          )}

          {statusMessage && (
            <div className="p-3.5 rounded-xl bg-emerald-950/70 border border-emerald-500/40 text-emerald-200 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}

          {/* Step 1: Authentication */}
          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-zinc-100">
                <KeyRound className="w-4 h-4 text-amber-400" />
                <span>1. Google Drive Authentication</span>
              </div>
              <button
                onClick={() => setShowGuide((v) => !v)}
                className="inline-flex items-center gap-1 text-xs text-amber-400 hover:underline cursor-pointer"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                {showGuide ? 'Hide 2-Min Setup Guide' : 'How to get a Client ID?'}
              </button>
            </div>

            {showGuide && (
              <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 space-y-2 leading-relaxed">
                <p className="font-semibold text-amber-300">
                  Fixing "no registered origin / Error 401: invalid_client":
                </p>
                <ol className="list-decimal list-inside space-y-1.5 text-zinc-400">
                  <li>
                    In <strong>Google Cloud Console → APIs & Services → Credentials</strong>, click your OAuth 2.0 Client ID (must be type <strong>Web application</strong>).
                  </li>
                  <li>
                    Under <strong>Authorized JavaScript origins</strong> (NOT just Redirect URIs), click <strong>+ Add URI</strong> and add both:
                    <div className="mt-1 flex items-center gap-2 font-mono text-amber-300 bg-zinc-900 px-2.5 py-1 rounded border border-zinc-800">
                      <span>{window.location.origin}</span>
                      <span className="text-zinc-600">and</span>
                      <span>http://localhost</span>
                    </div>
                  </li>
                  <li>
                    Under <strong>OAuth consent screen → Audience → Test users</strong>, add your Gmail address (e.g. <span className="text-zinc-200 font-mono">rohitkondaye@gmail.com</span>), then click <strong>Save</strong>.
                  </li>
                  <li className="text-zinc-500">
                    Note: Google Cloud can take 1–2 minutes for Authorized JavaScript origin changes to propagate.
                  </li>
                </ol>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs text-zinc-400">
                  Google Account Connection
                </label>
                {clientId && (
                  <span className="text-[11px] text-emerald-400 font-mono">
                    Client ID Pre-Configured ✓
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="1234567890-abcdefg.apps.googleusercontent.com"
                  className="flex-1 px-3.5 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 font-mono focus:outline-none focus:border-amber-500"
                />
                <button
                  onClick={handleOAuthSignIn}
                  className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs shrink-0 cursor-pointer"
                >
                  {isConnected ? 'Reconnect OAuth' : 'Sign in with Google'}
                </button>
              </div>
            </div>

            {/* Quick token fallback for instant testing */}
            <form onSubmit={handleManualTokenSubmit} className="pt-2 border-t border-zinc-800/80 space-y-2">
              <label className="block text-[11px] text-zinc-500">
                Or paste a direct OAuth Access Token (`ya29...`) for instant testing:
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  placeholder="ya29.a0..."
                  className="flex-1 px-3.5 py-1.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 font-mono"
                />
                <button
                  type="submit"
                  className="px-3.5 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium cursor-pointer"
                >
                  Use Token
                </button>
                {isConnected && (
                  <button
                    type="button"
                    onClick={() => {
                      clearAccessToken();
                    }}
                    className="px-3 py-1.5 rounded-xl bg-rose-950/60 hover:bg-rose-900/70 text-rose-300 text-xs inline-flex items-center gap-1 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Disconnect
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Step 2: Select Music Root Folder & Sync Index */}
          {isConnected && (
            <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-100">
                  2. Select Your Lossless Music Folder on Google Drive
                </span>
                <span className="text-xs font-mono text-amber-300">
                  Selected: {selectedFolder.name}
                </span>
              </div>

              {/* Breadcrumbs */}
              <div className="flex items-center gap-1 flex-wrap text-xs text-zinc-400 bg-zinc-950 px-3 py-2 rounded-lg border border-zinc-800">
                {breadcrumbs.map((crumb, idx) => (
                  <React.Fragment key={crumb.id}>
                    {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />}
                    <button
                      onClick={() => handleBreadcrumbClick(idx)}
                      className="hover:text-amber-300 font-medium cursor-pointer"
                    >
                      {crumb.name}
                    </button>
                  </React.Fragment>
                ))}
              </div>

              {/* Folder list */}
              <div className="max-h-44 overflow-y-auto rounded-xl bg-zinc-950 border border-zinc-800 divide-y divide-zinc-900">
                {loadingFolders ? (
                  <div className="p-4 text-xs text-zinc-500 flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Loading folders from Google Drive...
                  </div>
                ) : subfolders.length === 0 ? (
                  <div className="p-4 text-xs text-zinc-500">
                    No subfolders inside "{selectedFolder.name}". Click "Scan & Index This Folder" below to index audio files here.
                  </div>
                ) : (
                  subfolders.map((folder) => (
                    <button
                      key={folder.id}
                      onClick={() => handleNavigateIntoFolder(folder)}
                      className="w-full px-3.5 py-2.5 text-left text-xs text-zinc-200 hover:bg-zinc-900 flex items-center justify-between cursor-pointer"
                    >
                      <span className="flex items-center gap-2.5">
                        <Folder className="w-4 h-4 text-amber-400" />
                        {folder.name}
                      </span>
                      <ChevronRight className="w-4 h-4 text-zinc-600" />
                    </button>
                  ))
                )}
              </div>

              {/* Actions: Scan Folder OR Load Shared Index (for Office MacBook) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2">
                <button
                  onClick={() => onStartFolderScan(selectedFolder)}
                  className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" />
                  Scan & Index Folder
                </button>

                <button
                  onClick={() => onLoadCloudIndex(selectedFolder.id)}
                  className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 font-semibold text-xs cursor-pointer"
                  title="Instant 1-second load on your second laptop using the saved index on Google Drive"
                >
                  <CloudDownload className="w-4 h-4" />
                  Load Index from Drive
                </button>

                <button
                  onClick={() => onSaveCloudIndex(selectedFolder.id)}
                  className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold text-xs cursor-pointer"
                  title="Save indexed metadata & playlists to Google Drive so your MacBook & Windows laptop stay in sync"
                >
                  <CloudUpload className="w-4 h-4" />
                  Save Index to Drive
                </button>
              </div>
            </div>
          )}

          {/* Device Storage Footprint & Cache Control */}
          <div className="p-3.5 rounded-xl bg-zinc-900/40 border border-zinc-800/80 flex items-center justify-between gap-3 text-xs">
            <div className="text-zinc-400">
              <span className="font-semibold text-zinc-200">MeghSwara Storage Used: </span>
              <span className="font-mono text-amber-300">
                {storageUsedMb !== null ? `${storageUsedMb} MB` : 'Calculating...'}
              </span>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                Live streams use <code className="text-zinc-400">Cache-Control: no-store</code> (0 MB disk cache). Note: Android Settings shows Google Chrome&apos;s total browser cache across all sites.
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                if (typeof caches !== 'undefined') {
                  const keys = await caches.keys();
                  await Promise.all(keys.map((k) => caches.delete(k)));
                }
                await refreshStorageEstimate();
              }}
              className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium shrink-0 cursor-pointer"
            >
              Purge Audio Cache
            </button>
          </div>

          <div className="flex items-center justify-center pt-1">
            <button
              type="button"
              onClick={() => setIsPrivacyOpen(true)}
              className="text-[11px] text-zinc-500 hover:text-amber-300 underline underline-offset-2 cursor-pointer"
            >
              Privacy &amp; Data Use
            </button>
          </div>
        </div>
      </div>
      <PrivacyNotice isOpen={isPrivacyOpen} onClose={() => setIsPrivacyOpen(false)} />
    </div>
  );
};
