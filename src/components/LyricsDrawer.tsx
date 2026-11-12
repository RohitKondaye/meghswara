import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Mic2, X, Loader2, Sparkles } from 'lucide-react';
import { usePlayerStore } from '../store/playerStore';
import { fetchLyricsForTrack, type ParsedLyrics } from '../services/lyricsService';

export const LyricsDrawer: React.FC = () => {
  const { currentTrack, currentTime, isLyricsOpen, toggleLyricsDrawer, seek } =
    usePlayerStore();
  const [lyrics, setLyrics] = useState<ParsedLyrics | null>(null);
  const [loading, setLoading] = useState(false);
  const activeLineRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!currentTrack || !isLyricsOpen) return;
    let cancelled = false;
    setLoading(true);
    fetchLyricsForTrack(currentTrack)
      .then((res) => {
        if (!cancelled) {
          setLyrics(res);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentTrack?.id, isLyricsOpen]);

  const activeLineIndex = useMemo(() => {
    if (!lyrics || !lyrics.synced || lyrics.lines.length === 0) return -1;
    let idx = -1;
    for (let i = 0; i < lyrics.lines.length; i++) {
      if (currentTime + 0.15 >= lyrics.lines[i].time) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  }, [lyrics, currentTime]);

  useEffect(() => {
    if (activeLineRef.current) {
      activeLineRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [activeLineIndex]);

  if (!isLyricsOpen) return null;

  return (
    <div className="fixed inset-x-3 bottom-20 md:left-auto md:right-4 md:bottom-24 z-50 md:w-[420px] max-h-[68vh] flex flex-col rounded-2xl bg-zinc-950/95 backdrop-blur-2xl border border-zinc-800 shadow-2xl overflow-hidden select-none">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-zinc-800/80 flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <Mic2 className="w-4 h-4 text-amber-400 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-zinc-100 truncate">
              {currentTrack ? currentTrack.title : 'Synchronized Lyrics'}
            </h3>
            <p className="text-[11px] text-zinc-400 truncate">
              {lyrics?.source || 'LRCLIB Time-Synced Lyrics'}
              {lyrics?.synced ? ' • Tap any line to seek' : ''}
            </p>
          </div>
        </div>
        <button
          onClick={toggleLyricsDrawer}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-3">
        {!currentTrack ? (
          <div className="py-12 text-center text-xs text-zinc-500">
            Play any track to view synchronized lyrics.
          </div>
        ) : loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-zinc-400">
            <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
            <span>Searching LRCLIB for "{currentTrack.title}"...</span>
          </div>
        ) : !lyrics || lyrics.lines.length === 0 ? (
          <div className="py-12 text-center space-y-2">
            <Sparkles className="w-6 h-6 text-zinc-600 mx-auto" />
            <div className="text-xs font-medium text-zinc-300">
              No synchronized lyrics found for "{currentTrack.title}"
            </div>
            <p className="text-[11px] text-zinc-500">
              Instrumental track or not yet indexed on LRCLIB.
            </p>
          </div>
        ) : (
          lyrics.lines.map((line, idx) => {
            const isActive = idx === activeLineIndex;
            const isPast = activeLineIndex > idx;
            return (
              <button
                key={`${idx}-${line.time}`}
                ref={isActive ? activeLineRef : null}
                onClick={() => {
                  if (lyrics.synced) {
                    seek(line.time);
                  }
                }}
                className={`w-full text-left py-1.5 px-2.5 rounded-xl transition-all duration-200 cursor-pointer ${
                  isActive
                    ? 'text-base md:text-lg font-bold text-amber-300 bg-amber-500/10 scale-[1.01]'
                    : isPast
                    ? 'text-sm text-zinc-500 hover:text-zinc-300'
                    : 'text-sm text-zinc-300 hover:text-zinc-100'
                }`}
              >
                {line.text}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
