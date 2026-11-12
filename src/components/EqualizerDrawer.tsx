import React, { useEffect, useRef } from 'react';
import { Sliders, X, RotateCcw, ShieldCheck } from 'lucide-react';
import {
  EQ_FREQUENCIES,
  EQ_PRESETS,
  eqGraph,
  useEqualizerStore,
} from '../audio/equalizerEngine';
import { usePlayerStore } from '../store/playerStore';

export const EqualizerDrawer: React.FC = () => {
  const { isEqOpen, status, toggleEqDrawer, syncEqGraph } = usePlayerStore();
  const {
    enabled,
    preset,
    preampDb,
    gains,
    setEnabled,
    selectPreset,
    setBandGain,
    setPreampDb,
    resetFlat,
  } = useEqualizerStore();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Render live 60fps spectrum analyzer when drawer is open
  useEffect(() => {
    if (!isEqOpen) return;
    let rafId: number | null = null;
    const freqBins = new Uint8Array(64);

    const draw = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const width = canvas.width;
          const height = canvas.height;
          ctx.clearRect(0, 0, width, height);

          const hasRealData = enabled && eqGraph.getFrequencyData(freqBins);
          const barCount = 32;
          const barWidth = Math.floor((width - (barCount - 1) * 3) / barCount);

          for (let i = 0; i < barCount; i++) {
            let normalized = 0.06;
            if (hasRealData) {
              normalized = Math.max(0.06, freqBins[i] / 255);
            } else if (status === 'playing') {
              // Subtle harmonic wave preview when in Bit-Perfect Bypass mode
              const t = performance.now() / 350;
              normalized =
                0.15 +
                0.28 * Math.abs(Math.sin(t + i * 0.35)) * Math.exp(-i * 0.03);
            }

            const barHeight = Math.max(3, Math.round(normalized * (height - 6)));
            const x = i * (barWidth + 3);
            const y = height - barHeight;

            const grad = ctx.createLinearGradient(0, height, 0, 0);
            if (enabled) {
              grad.addColorStop(0, '#f59e0b');
              grad.addColorStop(1, '#34d399');
            } else {
              grad.addColorStop(0, '#52525b');
              grad.addColorStop(1, '#f59e0b');
            }
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.roundRect(x, y, barWidth, barHeight, 2);
            ctx.fill();
          }
        }
      }
      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [isEqOpen, enabled, status]);

  if (!isEqOpen) return null;

  const formatFreqLabel = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : `${hz}`);

  return (
    <div className="fixed inset-x-3 bottom-20 md:left-auto md:right-4 md:bottom-24 z-50 md:w-[500px] rounded-2xl bg-zinc-950/95 backdrop-blur-2xl border border-zinc-800 shadow-2xl overflow-hidden select-none p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <Sliders className="w-4 h-4 text-amber-400" />
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">
              10-Band Audiophile Equalizer & Spectrum
            </h3>
            <p className="text-[11px] text-zinc-400">
              {enabled
                ? 'Web Audio 10-Band Biquad DSP Active'
                : 'Bit-Perfect Direct Bypass Active (Untouched PCM)'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const next = !enabled;
              setEnabled(next);
              if (next) {
                syncEqGraph();
              }
            }}
            className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
              enabled
                ? 'bg-amber-500 text-zinc-950 border-amber-400'
                : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
            }`}
          >
            {enabled ? 'EQ: ON' : 'Bit-Perfect Bypass'}
          </button>

          <button
            onClick={toggleEqDrawer}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Live 60fps Frequency Spectrum Visualizer */}
      <div className="relative rounded-xl bg-zinc-900/90 border border-zinc-800/90 p-3">
        <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 mb-1.5">
          <span>REAL-TIME SPECTRUM ANALYZER (32Hz – 16kHz)</span>
          <span className="flex items-center gap-1 text-amber-300">
            <ShieldCheck className="w-3 h-3" />
            {enabled ? `${EQ_PRESETS[preset]?.label || 'Custom Curve'}` : 'Direct PCM'}
          </span>
        </div>
        <canvas
          ref={canvasRef}
          width={440}
          height={64}
          className="w-full h-16 block"
        />
      </div>

      {/* Preset Selector & Reset */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {Object.entries(EQ_PRESETS).map(([key, item]) => (
            <button
              key={key}
              onClick={() => {
                if (!enabled) {
                  setEnabled(true);
                  syncEqGraph();
                }
                selectPreset(key);
              }}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                preset === key && enabled
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <button
          onClick={resetFlat}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-[11px] border border-zinc-800 cursor-pointer"
          title="Reset all bands to 0 dB"
        >
          <RotateCcw className="w-3 h-3" />
          Flat
        </button>
      </div>

      {/* Preamp + 10 Frequency Sliders */}
      <div className="pt-1">
        <div className="grid grid-cols-11 gap-1.5 items-center text-center">
          {/* Preamp column */}
          <div className="flex flex-col items-center gap-1.5 pr-1 border-r border-zinc-800">
            <span className="text-[10px] font-mono text-amber-400">
              {preampDb > 0 ? `+${preampDb.toFixed(1)}` : preampDb.toFixed(1)}
            </span>
            <div className="h-28 flex items-center justify-center">
              <input
                type="range"
                min={-12}
                max={6}
                step={0.5}
                value={preampDb}
                onChange={(e) => {
                  if (!enabled) {
                    setEnabled(true);
                    syncEqGraph();
                  }
                  setPreampDb(parseFloat(e.target.value));
                }}
                className="w-24 -rotate-90 accent-amber-400 cursor-pointer"
              />
            </div>
            <span className="text-[10px] font-mono text-zinc-400">PRE</span>
          </div>

          {/* 10 Frequency Bands */}
          {EQ_FREQUENCIES.map((freq, idx) => {
            const gain = gains[idx] ?? 0;
            return (
              <div key={freq} className="flex flex-col items-center gap-1.5">
                <span className="text-[10px] font-mono text-zinc-300">
                  {gain > 0 ? `+${gain.toFixed(1)}` : gain.toFixed(1)}
                </span>
                <div className="h-28 flex items-center justify-center">
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={0.5}
                    value={gain}
                    onChange={(e) => {
                      if (!enabled) {
                        setEnabled(true);
                        syncEqGraph();
                      }
                      setBandGain(idx, parseFloat(e.target.value));
                    }}
                    className="w-24 -rotate-90 accent-amber-400 cursor-pointer"
                  />
                </div>
                <span className="text-[10px] font-mono text-zinc-500">
                  {formatFreqLabel(freq)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
