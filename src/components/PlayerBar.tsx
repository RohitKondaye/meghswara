import React, { useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  ListMusic,
  ShieldCheck,
  Loader2,
  Trash2,
  AlertCircle,
  X,
  ChevronDown,
  Disc3,
  Mic2,
  Sliders,
} from 'lucide-react';
import { usePlayerStore } from '../store/playerStore';
import { useEqualizerStore } from '../audio/equalizerEngine';
import { formatDuration, formatSignalBadge, formatFileSize } from '../utils/formatters';
import { LyricsDrawer } from './LyricsDrawer';
import { EqualizerDrawer } from './EqualizerDrawer';

interface PlayerBarProps {
  coverMap: Map<string, string>;
  onNavigateToAlbum?: (albumId: string) => void;
}

export const PlayerBar: React.FC<PlayerBarProps> = ({ coverMap, onNavigateToAlbum }) => {
  const {
    currentTrack,
    queue,
    currentIndex,
    status,
    currentTime,
    duration,
    bufferedEnd,
    volume,
    muted,
    shuffle,
    repeat,
    isQueueOpen,
    isLyricsOpen,
    isEqOpen,
    errorMessage,
    gaplessTransitionsCount,
    togglePlayPause,
    nextTrack,
    previousTrack,
    seek,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeatMode,
    toggleQueueDrawer,
    toggleLyricsDrawer,
    toggleEqDrawer,
    jumpToQueueIndex,
    removeFromQueue,
    clearError,
  } = usePlayerStore();
  const eqEnabled = useEqualizerStore((s) => s.enabled);

  const [showSignalPath, setShowSignalPath] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);

  const activeDuration = duration > 0 ? duration : currentTrack?.duration || 0;
  const progressPercent =
    activeDuration > 0 ? Math.min(100, (currentTime / activeDuration) * 100) : 0;
  const bufferedPercent =
    activeDuration > 0 ? Math.min(100, (bufferedEnd / activeDuration) * 100) : 0;

  const coverUrl = currentTrack
    ? coverMap.get(currentTrack.albumId) || currentTrack.demoCoverUrl
    : undefined;

  const badge = currentTrack ? formatSignalBadge(currentTrack) : null;

  return (
    <>
      <LyricsDrawer />
      <EqualizerDrawer />

      {/* Error Toast if playback fails */}
      {errorMessage && (
        <div className="fixed bottom-36 md:bottom-28 left-1/2 -translate-x-1/2 z-50 w-[90vw] max-w-md flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-rose-950/95 border border-rose-500/40 text-rose-200 text-xs shadow-2xl">
          <div className="flex items-center gap-2.5 min-w-0">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="truncate">{errorMessage}</span>
          </div>
          <button
            onClick={clearError}
            className="p-1 hover:bg-rose-900/60 rounded cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Signal Path Audiophile Popover */}
      {showSignalPath && currentTrack && badge && (
        <div className="fixed bottom-24 left-4 right-4 md:left-72 md:right-auto z-50 md:w-80 p-4 rounded-2xl bg-zinc-900/95 backdrop-blur-xl border border-zinc-700/80 shadow-2xl space-y-3 text-xs">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-400" />
              <span className="font-semibold text-zinc-100">Lossless Signal Path</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono text-[10px]">
                Bit-Perfect
              </span>
              <button
                onClick={() => setShowSignalPath(false)}
                className="p-1 text-zinc-400 hover:text-zinc-100"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="space-y-2.5 text-zinc-300">
            <div className="flex items-start justify-between gap-2">
              <span className="text-zinc-400 shrink-0">Raw File:</span>
              <span
                className="font-mono text-[11px] text-zinc-200 truncate"
                title={currentTrack.name}
              >
                {currentTrack.name}
              </span>
            </div>
            <div className="flex items-start justify-between">
              <span className="text-zinc-400">Source Stream:</span>
              <span className="font-medium text-right">
                {currentTrack.demoStreamUrl
                  ? 'Synthesized PCM Reference'
                  : 'Drive API v3 (?alt=media Raw Binary)'}
              </span>
            </div>
            <div className="flex items-start justify-between">
              <span className="text-zinc-400">Format & Depth:</span>
              <span className="font-mono text-amber-300">{badge.detail}</span>
            </div>
            {(currentTrack.bitrate || (currentTrack.size > 0 && activeDuration > 0)) && (
              <div className="flex items-start justify-between">
                <span className="text-zinc-400">Lossless Bitrate:</span>
                <span className="font-mono text-emerald-300">
                  {Math.round(
                    (currentTrack.bitrate ||
                      (currentTrack.size * 8) / Math.max(1, activeDuration)) / 1000
                  )}{' '}
                  kbps
                </span>
              </div>
            )}
            {currentTrack.size > 0 && (
              <div className="flex items-start justify-between">
                <span className="text-zinc-400">Original Size:</span>
                <span className="font-mono">{formatFileSize(currentTrack.size)}</span>
              </div>
            )}
            <div className="flex items-start justify-between">
              <span className="text-zinc-400">fLaC Header:</span>
              <span className="text-emerald-400 font-medium">
                {currentTrack.isHeaderIndexed
                  ? 'Verified (STREAMINFO Binary)'
                  : 'Pending Header Scan'}
              </span>
            </div>
            <div className="flex items-start justify-between">
              <span className="text-zinc-400">Gapless Handoffs:</span>
              <span className="font-mono">{gaplessTransitionsCount}</span>
            </div>
          </div>
        </div>
      )}

      {/* Slide-Up Queue Drawer (Responsive for Mobile & Desktop) */}
      {isQueueOpen && (
        <div className="fixed inset-x-3 bottom-20 md:left-auto md:right-4 md:bottom-24 z-50 md:w-96 max-h-[65vh] flex flex-col rounded-2xl bg-zinc-900/95 backdrop-blur-xl border border-zinc-800 shadow-2xl overflow-hidden">
          <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">Playback Queue</h3>
              <p className="text-xs text-zinc-400">
                {queue.length} tracks • Gapless Dual-Deck Active
              </p>
            </div>
            <button
              onClick={toggleQueueDrawer}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/50">
            {queue.length === 0 ? (
              <div className="p-8 text-center text-xs text-zinc-500">Queue is empty</div>
            ) : (
              queue.map((track, idx) => {
                const isCurrent = idx === currentIndex;
                return (
                  <div
                    key={`${track.id}-${idx}`}
                    className={`flex items-center justify-between px-4 py-2.5 text-xs transition-colors ${
                      isCurrent
                        ? 'bg-amber-500/10 text-amber-300'
                        : 'hover:bg-zinc-800/60 text-zinc-300'
                    }`}
                  >
                    <button
                      onClick={() => jumpToQueueIndex(idx)}
                      className="flex-1 text-left truncate pr-3 cursor-pointer"
                    >
                      <div className="font-medium truncate">
                        {idx + 1}. {track.title}
                      </div>
                      <div className="text-[11px] text-zinc-500 truncate">
                        {track.artist} • {track.format}
                      </div>
                    </button>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono text-[11px] text-zinc-500">
                        {formatDuration(track.duration)}
                      </span>
                      <button
                        onClick={() => removeFromQueue(idx)}
                        className="p-1 text-zinc-500 hover:text-rose-400 cursor-pointer"
                        title="Remove from queue"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Mobile Full-Screen "Now Playing" Sheet (< md) */}
      {mobileExpanded && currentTrack && (
        <div className="md:hidden fixed inset-0 z-40 bg-zinc-950/98 backdrop-blur-2xl flex flex-col justify-between p-6 select-none">
          {/* Top bar */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setMobileExpanded(false)}
              className="p-2 -ml-2 rounded-xl text-zinc-400 active:bg-zinc-900"
            >
              <ChevronDown className="w-6 h-6" />
            </button>
            <div className="text-center">
              <div className="text-[10px] font-mono uppercase tracking-widest text-amber-400">
                Now Streaming
              </div>
              <div className="text-xs text-zinc-400 truncate max-w-[200px]">
                {currentTrack.album}
              </div>
            </div>
            <div className="flex items-center gap-1 -mr-2">
              <button
                onClick={toggleLyricsDrawer}
                className={`p-2 rounded-xl ${
                  isLyricsOpen ? 'text-amber-400 bg-amber-500/15' : 'text-zinc-400'
                }`}
                title="Synchronized Lyrics"
              >
                <Mic2 className="w-5 h-5" />
              </button>
              <button
                onClick={toggleEqDrawer}
                className={`p-2 rounded-xl ${
                  isEqOpen || eqEnabled ? 'text-amber-400 bg-amber-500/15' : 'text-zinc-400'
                }`}
                title="10-Band Equalizer & Spectrum"
              >
                <Sliders className="w-5 h-5" />
              </button>
              <button
                onClick={toggleQueueDrawer}
                className={`p-2 rounded-xl ${
                  isQueueOpen ? 'text-amber-400 bg-amber-500/15' : 'text-zinc-400'
                }`}
                title="Playback Queue"
              >
                <ListMusic className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Center Artwork */}
          <div className="my-auto py-4 flex flex-col items-center gap-6">
            <div className="w-64 h-64 sm:w-72 sm:h-72 rounded-3xl bg-zinc-900 border border-zinc-800 shadow-2xl overflow-hidden flex items-center justify-center">
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt={currentTrack.album}
                  className="w-full h-full object-cover"
                />
              ) : (
                <Disc3 className="w-20 h-20 text-amber-400/40" />
              )}
            </div>

            <div className="w-full text-center space-y-1.5 px-2">
              <h2 className="text-xl font-bold text-zinc-100 truncate">
                {currentTrack.title}
              </h2>
              <p
                onClick={() => {
                  setMobileExpanded(false);
                  onNavigateToAlbum?.(currentTrack.albumId);
                }}
                className="text-sm text-zinc-400 truncate active:text-amber-300"
              >
                {currentTrack.artist} — {currentTrack.album}
              </p>

              {badge && (
                <div className="pt-1">
                  <button
                    onClick={() => setShowSignalPath((v) => !v)}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono bg-amber-500/15 text-amber-300 border border-amber-500/40"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {badge.detail}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Seek & Transport Controls */}
          <div className="space-y-6 pb-4">
            <div className="space-y-2">
              <div className="relative h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-zinc-700"
                  style={{ width: `${bufferedPercent}%` }}
                />
                <div
                  className="absolute inset-y-0 left-0 bg-amber-400"
                  style={{ width: `${progressPercent}%` }}
                />
                <input
                  type="range"
                  min={0}
                  max={activeDuration || 100}
                  step={0.1}
                  value={currentTime}
                  onChange={(e) => seek(parseFloat(e.target.value))}
                  className="absolute inset-0 w-full h-full opacity-0"
                />
              </div>
              <div className="flex justify-between text-[11px] font-mono text-zinc-400">
                <span>{formatDuration(currentTime)}</span>
                <span>{formatDuration(activeDuration)}</span>
              </div>
            </div>

            <div className="flex items-center justify-between px-4">
              <button
                onClick={toggleShuffle}
                className={`p-2 rounded-xl ${
                  shuffle ? 'text-amber-400 bg-amber-500/15' : 'text-zinc-400'
                }`}
              >
                <Shuffle className="w-5 h-5" />
              </button>

              <button
                onClick={previousTrack}
                className="p-2 text-zinc-200 active:scale-95"
              >
                <SkipBack className="w-7 h-7" />
              </button>

              <button
                onClick={togglePlayPause}
                className="w-16 h-16 rounded-full bg-amber-500 text-zinc-950 flex items-center justify-center shadow-xl shadow-amber-500/25 active:scale-95"
              >
                {status === 'buffering' ? (
                  <Loader2 className="w-7 h-7 animate-spin" />
                ) : status === 'playing' ? (
                  <Pause className="w-7 h-7 fill-current" />
                ) : (
                  <Play className="w-7 h-7 fill-current ml-1" />
                )}
              </button>

              <button
                onClick={nextTrack}
                className="p-2 text-zinc-200 active:scale-95"
              >
                <SkipForward className="w-7 h-7" />
              </button>

              <button
                onClick={cycleRepeatMode}
                className={`p-2 rounded-xl ${
                  repeat !== 'off' ? 'text-amber-400 bg-amber-500/15' : 'text-zinc-400'
                }`}
              >
                {repeat === 'one' ? (
                  <Repeat1 className="w-5 h-5" />
                ) : (
                  <Repeat className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Floating Mini-Player Pill (< md, pinned above the 16-height bottom nav bar) */}
      {currentTrack && !mobileExpanded && (
        <div
          onClick={() => setMobileExpanded(true)}
          className="md:hidden fixed bottom-17 inset-x-2.5 z-30 rounded-2xl bg-zinc-900/95 backdrop-blur-xl border border-zinc-800 shadow-2xl overflow-hidden select-none"
        >
          {/* Thin progress bar along top edge */}
          <div className="h-1 w-full bg-zinc-800">
            <div
              className="h-full bg-amber-400 transition-all duration-100"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="px-3 py-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="w-10 h-10 rounded-lg bg-zinc-800 overflow-hidden shrink-0 border border-zinc-700">
                {coverUrl ? (
                  <img
                    src={coverUrl}
                    alt={currentTrack.album}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px] font-mono text-amber-400">
                    FLAC
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-zinc-100 truncate">
                  {currentTrack.title}
                </div>
                <div className="text-[11px] text-zinc-400 truncate flex items-center gap-1.5">
                  <span className="truncate">{currentTrack.artist}</span>
                  {badge && (
                    <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0">
                      {currentTrack.format}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div
              className="flex items-center gap-1 shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={togglePlayPause}
                className="w-9 h-9 rounded-full bg-amber-500 text-zinc-950 flex items-center justify-center active:scale-95"
              >
                {status === 'buffering' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : status === 'playing' ? (
                  <Pause className="w-4 h-4 fill-current" />
                ) : (
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                )}
              </button>
              <button
                onClick={nextTrack}
                className="p-2 text-zinc-300 active:text-white"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Desktop Bottom Player Bar (md+) */}
      <footer className="hidden md:flex h-22 shrink-0 bg-zinc-950/95 backdrop-blur-md border-t border-zinc-800/80 px-6 items-center justify-between gap-6 select-none z-30">
        {/* Left: Track Info & Signal Badge */}
        <div className="w-80 flex items-center gap-3.5 min-w-0">
          {currentTrack ? (
            <>
              <div
                onClick={() => onNavigateToAlbum?.(currentTrack.albumId)}
                className="w-14 h-14 rounded-xl bg-zinc-900 border border-zinc-800 overflow-hidden shrink-0 cursor-pointer group relative"
              >
                {coverUrl ? (
                  <img
                    src={coverUrl}
                    alt={currentTrack.album}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-amber-400/50 font-mono text-xs">
                    FLAC
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="text-sm font-semibold text-zinc-100 truncate">
                  {currentTrack.title}
                </div>
                <div className="text-xs text-zinc-400 truncate">
                  {currentTrack.artist} —{' '}
                  <button
                    onClick={() => onNavigateToAlbum?.(currentTrack.albumId)}
                    className="hover:text-amber-300 hover:underline cursor-pointer"
                  >
                    {currentTrack.album}
                  </button>
                </div>
                {badge && (
                  <button
                    onClick={() => setShowSignalPath((v) => !v)}
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono tracking-wide border cursor-pointer transition-colors ${
                      badge.tier === 'hires'
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/25'
                        : badge.tier === 'lossless'
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25'
                        : 'bg-zinc-800 text-zinc-300 border-zinc-700'
                    }`}
                    title="Click to inspect lossless audio signal path"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                    {badge.detail}
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="text-xs text-zinc-500">Select any album or track to begin streaming</div>
          )}
        </div>

        {/* Center: Transport Controls + Range Seek Bar */}
        <div className="flex-1 max-w-2xl flex flex-col items-center gap-2">
          <div className="flex items-center gap-5">
            <button
              onClick={toggleShuffle}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                shuffle ? 'text-amber-400 bg-amber-500/10' : 'text-zinc-400 hover:text-zinc-100'
              }`}
              title="Shuffle Queue"
            >
              <Shuffle className="w-4 h-4" />
            </button>

            <button
              onClick={previousTrack}
              disabled={!currentTrack}
              className="p-1.5 text-zinc-300 hover:text-white disabled:opacity-40 cursor-pointer"
              title="Previous Track"
            >
              <SkipBack className="w-5 h-5" />
            </button>

            <button
              onClick={togglePlayPause}
              disabled={!currentTrack}
              className="w-10 h-10 rounded-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 flex items-center justify-center shadow-lg shadow-amber-500/20 transition-transform active:scale-95 cursor-pointer"
              title={status === 'playing' ? 'Pause' : 'Play'}
            >
              {status === 'buffering' ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : status === 'playing' ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current ml-0.5" />
              )}
            </button>

            <button
              onClick={nextTrack}
              disabled={!currentTrack}
              className="p-1.5 text-zinc-300 hover:text-white disabled:opacity-40 cursor-pointer"
              title="Next Track"
            >
              <SkipForward className="w-5 h-5" />
            </button>

            <button
              onClick={cycleRepeatMode}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                repeat !== 'off'
                  ? 'text-amber-400 bg-amber-500/10'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
              title={`Repeat: ${repeat.toUpperCase()}`}
            >
              {repeat === 'one' ? (
                <Repeat1 className="w-4 h-4" />
              ) : (
                <Repeat className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* Seek Bar with HTTP 206 Buffered Range Indicator */}
          <div className="w-full flex items-center gap-3 text-[11px] font-mono text-zinc-400">
            <span className="w-10 text-right">{formatDuration(currentTime)}</span>
            <div className="relative flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden group">
              <div
                className="absolute inset-y-0 left-0 bg-zinc-700 transition-all duration-150"
                style={{ width: `${bufferedPercent}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 bg-amber-400 transition-all duration-75"
                style={{ width: `${progressPercent}%` }}
              />
              <input
                type="range"
                min={0}
                max={activeDuration || 100}
                step={0.1}
                value={currentTime}
                disabled={!currentTrack}
                onChange={(e) => seek(parseFloat(e.target.value))}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>
            <span className="w-10">{formatDuration(activeDuration)}</span>
          </div>
        </div>

        {/* Right: Lyrics, EQ, Queue & Volume Controls */}
        <div className="w-80 flex items-center justify-end gap-2">
          <button
            onClick={toggleLyricsDrawer}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
              isLyricsOpen
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-700'
            }`}
            title="Synchronized LRC Lyrics"
          >
            <Mic2 className="w-3.5 h-3.5" />
            <span>Lyrics</span>
          </button>

          <button
            onClick={toggleEqDrawer}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
              isEqOpen || eqEnabled
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-700'
            }`}
            title="10-Band Equalizer & Live Spectrum Visualizer"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>EQ</span>
          </button>

          <button
            onClick={toggleQueueDrawer}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
              isQueueOpen
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-700'
            }`}
            title="Toggle Playback Queue"
          >
            <ListMusic className="w-4 h-4" />
            <span className="font-mono">{queue.length}</span>
          </button>

          <button
            onClick={toggleMute}
            className="p-1.5 text-zinc-400 hover:text-zinc-100 cursor-pointer"
            title={muted ? 'Unmute' : 'Mute'}
          >
            {muted || volume === 0 ? (
              <VolumeX className="w-4 h-4 text-rose-400" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </button>

          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="w-24 accent-amber-400 cursor-pointer"
          />
        </div>
      </footer>
    </>
  );
};
