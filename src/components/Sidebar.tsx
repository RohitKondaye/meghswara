import React from 'react';
import {
  Disc3,
  FolderTree,
  HardDrive,
  ListMusic,
  Music2,
  RefreshCw,
  Sparkles,
  Users,
  CheckCircle2,
  CloudUpload,
} from 'lucide-react';
import type { IndexerProgress } from '../services/metadataIndexer';
import type { ScanProgress } from '../services/driveApi';

export type NavTab = 'albums' | 'artists' | 'tracks' | 'folders' | 'playlists';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  isConnected: boolean;
  rootFolderName?: string;
  trackCount: number;
  albumCount: number;
  scanProgress: ScanProgress | null;
  indexerProgress: IndexerProgress | null;
  onOpenDriveModal: () => void;
  onQuickSyncToCloud: () => void;
  isSyncingCloud: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  isConnected,
  rootFolderName,
  trackCount,
  albumCount,
  scanProgress,
  indexerProgress,
  onOpenDriveModal,
  onQuickSyncToCloud,
  isSyncingCloud,
}) => {
  const navItems: { id: NavTab; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: 'albums', label: 'Albums', icon: <Disc3 className="w-4 h-4" />, count: albumCount },
    { id: 'artists', label: 'Artists', icon: <Users className="w-4 h-4" /> },
    { id: 'tracks', label: 'All Tracks', icon: <Music2 className="w-4 h-4" />, count: trackCount },
    { id: 'folders', label: 'Drive Folders', icon: <FolderTree className="w-4 h-4" /> },
    { id: 'playlists', label: 'Playlists', icon: <ListMusic className="w-4 h-4" /> },
  ];

  return (
    <aside className="w-64 shrink-0 bg-zinc-950 border-r border-zinc-800/80 flex flex-col justify-between select-none">
      <div className="p-4 space-y-6">
        {/* Brand Header */}
        <div className="flex items-center gap-3 px-2">
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-inner">
            <Disc3 className="w-5 h-5 animate-spin" style={{ animationDuration: '14s' }} />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold tracking-tight text-zinc-100 text-base">
                MeghSwara
              </span>
              <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                FLAC
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">Cloud Lossless Audio</p>
          </div>
        </div>

        {/* Library Navigation */}
        <nav className="space-y-1">
          <div className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Library
          </div>
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  active
                    ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/70 border border-transparent'
                }`}
              >
                <span className="flex items-center gap-3">
                  {item.icon}
                  {item.label}
                </span>
                {typeof item.count === 'number' && item.count > 0 && (
                  <span
                    className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                      active ? 'bg-amber-500/20 text-amber-200' : 'bg-zinc-900 text-zinc-400'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Drive Connection & Indexer Status */}
      <div className="p-4 space-y-3 border-t border-zinc-900">
        {scanProgress && (
          <div className="p-3 rounded-lg bg-zinc-900/90 border border-amber-500/30 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-amber-300 font-medium">
              <span className="flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Scanning Drive...
              </span>
              <span className="font-mono">{scanProgress.tracksFound} tracks</span>
            </div>
            <p className="text-[11px] text-zinc-400 truncate" title={scanProgress.currentFolder}>
              {scanProgress.currentFolder}
            </p>
          </div>
        )}

        {indexerProgress && (
          <div className="p-3 rounded-lg bg-zinc-900/90 border border-emerald-500/30 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-emerald-300 font-medium">
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                Indexing FLAC Tags
              </span>
              <span className="font-mono">
                {indexerProgress.completed}/{indexerProgress.total}
              </span>
            </div>
            <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-400 transition-all duration-200"
                style={{
                  width: `${Math.round(
                    (indexerProgress.completed / Math.max(1, indexerProgress.total)) * 100
                  )}%`,
                }}
              />
            </div>
            <p className="text-[11px] text-zinc-400 truncate">
              {indexerProgress.currentTrackTitle}
            </p>
          </div>
        )}

        <div className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/80 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-amber-400" />
              Google Drive
            </span>
            {isConnected ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                <CheckCircle2 className="w-3 h-3" />
                Connected
              </span>
            ) : (
              <span className="text-[11px] text-amber-400/90 font-medium">Demo Mode</span>
            )}
          </div>

          <p className="text-xs text-zinc-400 truncate">
            {isConnected
              ? `Folder: ${rootFolderName || 'My Drive'}`
              : 'Playing synthesized 24-bit lossless demo suite'}
          </p>

          <div className="flex gap-1.5">
            <button
              onClick={onOpenDriveModal}
              className="flex-1 py-2 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs transition-colors cursor-pointer"
            >
              {isConnected ? 'Manage Drive' : 'Connect Google Drive'}
            </button>
            {isConnected && (
              <button
                onClick={onQuickSyncToCloud}
                disabled={isSyncingCloud}
                title="Save library index & playlists to Google Drive for instant loading on your MacBook / Windows laptop"
                className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors cursor-pointer disabled:opacity-50"
              >
                <CloudUpload
                  className={`w-4 h-4 ${isSyncingCloud ? 'animate-bounce text-amber-400' : ''}`}
                />
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
};
