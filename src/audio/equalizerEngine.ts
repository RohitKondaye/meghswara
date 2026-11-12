import { create } from 'zustand';

export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

export const EQ_PRESETS: Record<string, { label: string; gains: number[] }> = {
  flat: {
    label: 'Flat (Reference)',
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  harman: {
    label: 'Harman Target Curve',
    gains: [4.5, 3.8, 1.5, -0.5, 0, 1.2, 2.8, 3.2, 2.0, 1.0],
  },
  warm_tubes: {
    label: 'Warm Tubes & Bass',
    gains: [5.0, 4.2, 2.5, 1.0, -0.5, -0.8, 0.5, 1.5, 1.8, 0.5],
  },
  vocal_clarity: {
    label: 'Vocal & Acoustic Detail',
    gains: [-1.5, -1.0, 0, 1.8, 3.2, 3.5, 2.8, 1.5, 1.0, 0.5],
  },
  v_shape: {
    label: 'Dynamic V-Shape',
    gains: [5.5, 4.5, 1.5, -1.5, -2.0, -1.0, 2.0, 3.8, 4.5, 4.0],
  },
};

interface EqualizerStoreState {
  enabled: boolean; // false = Bit-Perfect Bypass ON, true = 10-Band EQ + FFT Active
  preset: string;
  preampDb: number;
  gains: number[]; // 10 bands (-12 dB to +12 dB)
  setEnabled: (enabled: boolean) => void;
  selectPreset: (presetKey: string) => void;
  setBandGain: (index: number, gainDb: number) => void;
  setPreampDb: (db: number) => void;
  resetFlat: () => void;
}

class WebAudioEqualizerGraph {
  private ctx: AudioContext | null = null;
  private preampNode: GainNode | null = null;
  private filterNodes: BiquadFilterNode[] = [];
  private analyser: AnalyserNode | null = null;
  private connectedElements = new WeakSet<HTMLAudioElement>();

  public ensureInitialized(): void {
    if (this.ctx || typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.preampNode = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 128;
    this.analyser.smoothingTimeConstant = 0.8;

    this.filterNodes = EQ_FREQUENCIES.map((freq, idx) => {
      const filter = this.ctx!.createBiquadFilter();
      if (idx === 0) {
        filter.type = 'lowshelf';
      } else if (idx === EQ_FREQUENCIES.length - 1) {
        filter.type = 'highshelf';
      } else {
        filter.type = 'peaking';
        filter.Q.value = 1.4;
      }
      filter.frequency.value = freq;
      filter.gain.value = 0;
      return filter;
    });

    // Chain: preamp -> filter[0] -> ... -> filter[9] -> analyser -> destination
    let prev: AudioNode = this.preampNode;
    for (const f of this.filterNodes) {
      prev.connect(f);
      prev = f;
    }
    prev.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  public attachAudioElements(deckA: HTMLAudioElement, deckB: HTMLAudioElement): void {
    this.ensureInitialized();
    if (!this.ctx || !this.preampNode) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    for (const deck of [deckA, deckB]) {
      if (!this.connectedElements.has(deck)) {
        try {
          const source = this.ctx.createMediaElementSource(deck);
          source.connect(this.preampNode);
          this.connectedElements.add(deck);
        } catch (err) {
          console.warn('Could not attach deck to WebAudio EQ:', err);
        }
      }
    }
  }

  public applySettings(enabled: boolean, preampDb: number, gains: number[]): void {
    if (!this.ctx || !this.preampNode) return;
    if (this.ctx.state === 'suspended' && enabled) {
      this.ctx.resume().catch(() => {});
    }

    if (!enabled) {
      // Bit-perfect unity pass-through when bypassed
      this.preampNode.gain.value = 1.0;
      for (const f of this.filterNodes) {
        f.gain.value = 0;
      }
      return;
    }

    this.preampNode.gain.value = Math.pow(10, preampDb / 20);
    this.filterNodes.forEach((f, idx) => {
      f.gain.value = gains[idx] ?? 0;
    });
  }

  public getFrequencyData(targetBuffer: Uint8Array): boolean {
    if (!this.analyser || !this.ctx || this.ctx.state !== 'running') {
      return false;
    }
    this.analyser.getByteFrequencyData(targetBuffer);
    return true;
  }
}

export const eqGraph = new WebAudioEqualizerGraph();

export const useEqualizerStore = create<EqualizerStoreState>((set, get) => ({
  enabled: false,
  preset: 'harman',
  preampDb: 0,
  gains: [...EQ_PRESETS.harman.gains],

  setEnabled: (enabled) => {
    set({ enabled });
    const { preampDb, gains } = get();
    eqGraph.applySettings(enabled, preampDb, gains);
  },

  selectPreset: (presetKey) => {
    const presetObj = EQ_PRESETS[presetKey];
    if (!presetObj) return;
    const nextGains = [...presetObj.gains];
    set({ preset: presetKey, gains: nextGains });
    eqGraph.applySettings(get().enabled, get().preampDb, nextGains);
  },

  setBandGain: (index, gainDb) => {
    const clamped = Math.max(-12, Math.min(12, gainDb));
    const nextGains = [...get().gains];
    nextGains[index] = clamped;
    set({ preset: 'custom', gains: nextGains });
    eqGraph.applySettings(get().enabled, get().preampDb, nextGains);
  },

  setPreampDb: (preampDb) => {
    const clamped = Math.max(-12, Math.min(6, preampDb));
    set({ preampDb: clamped });
    eqGraph.applySettings(get().enabled, clamped, get().gains);
  },

  resetFlat: () => {
    const flatGains = [...EQ_PRESETS.flat.gains];
    set({ preset: 'flat', preampDb: 0, gains: flatGains });
    eqGraph.applySettings(get().enabled, 0, flatGains);
  },
}));
