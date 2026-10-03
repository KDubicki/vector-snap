import { create } from 'zustand';
import { ApiError, getLimits, quantize, vectorize } from '../api/client';
import { base64ToBlob } from '../lib/base64';
import { finalPalette } from '../lib/color';
import type {
  Limits,
  QuantizeAlgorithm,
  QuantizeResponse,
  TracingOptions,
  VectorizeResponse,
} from '../types/api';

export type Step = 'upload' | 'palette' | 'result';
export type Status = 'idle' | 'quantizing' | 'vectorizing';

export const DEFAULT_COLORS = 8;
export const DEFAULT_TRACING: TracingOptions = {
  mode: 'spline',
  stacking: 'cutout',
  filter_speckle: 4,
  corner_threshold: 60,
  length_threshold: 4,
  splice_threshold: 45,
  path_precision: 2,
};

export interface AppState {
  step: Step;
  limits: Pick<Limits, 'min_colors' | 'max_colors' | 'max_upload_mb'>;
  file: File | null;
  colors: number;
  algorithm: QuantizeAlgorithm;
  quantized: QuantizeResponse | null;
  /** Parameters that produced `quantized`; avoids re-quantizing (and losing edits) needlessly. */
  quantizedFor: { file: File; colors: number; algorithm: QuantizeAlgorithm } | null;
  overrides: Record<number, string>;
  tracing: TracingOptions;
  vectorized: VectorizeResponse | null;
  status: Status;
  error: string | null;

  loadLimits: () => Promise<void>;
  selectFile: (file: File) => void;
  setColors: (colors: number) => void;
  setAlgorithm: (algorithm: QuantizeAlgorithm) => void;
  setOverride: (index: number, hex: string) => void;
  resetOverride: (index: number) => void;
  resetOverrides: () => void;
  setTracing: (options: Partial<TracingOptions>) => void;
  runQuantize: () => Promise<void>;
  runVectorize: () => Promise<void>;
  goTo: (step: Step) => void;
  reset: () => void;
}

const initialState = {
  step: 'upload' as Step,
  limits: { min_colors: 2, max_colors: 64, max_upload_mb: 10 },
  file: null,
  colors: DEFAULT_COLORS,
  algorithm: 'kmeans' as QuantizeAlgorithm,
  quantized: null,
  quantizedFor: null,
  overrides: {},
  tracing: DEFAULT_TRACING,
  vectorized: null,
  status: 'idle' as Status,
  error: null,
};

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Unexpected error';
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

let pending: AbortController | null = null;

/** Abort the in-flight request (if any) and return a signal for the next one. */
function nextSignal(): AbortSignal {
  pending?.abort();
  pending = new AbortController();
  return pending.signal;
}

export const useAppStore = create<AppState>()((set, get) => ({
  ...initialState,

  loadLimits: async () => {
    try {
      const limits = await getLimits();
      set((state) => ({
        limits,
        colors: Math.min(Math.max(state.colors, limits.min_colors), limits.max_colors),
      }));
    } catch {
      // Keep defaults; the backend still validates every request.
    }
  },

  selectFile: (file) => {
    const { max_upload_mb } = get().limits;
    if (file.size > max_upload_mb * 1024 * 1024) {
      set({ error: `File is larger than ${max_upload_mb} MB.` });
      return;
    }
    set({
      file,
      step: 'palette',
      quantized: null,
      quantizedFor: null,
      overrides: {},
      vectorized: null,
      error: null,
    });
  },

  setColors: (colors) => set({ colors }),
  setAlgorithm: (algorithm) => set({ algorithm }),

  setOverride: (index, hex) =>
    set((state) => ({ overrides: { ...state.overrides, [index]: hex.toLowerCase() } })),
  resetOverride: (index) =>
    set((state) => {
      const overrides = { ...state.overrides };
      delete overrides[index];
      return { overrides };
    }),
  resetOverrides: () => set({ overrides: {} }),

  setTracing: (options) => set((state) => ({ tracing: { ...state.tracing, ...options } })),

  runQuantize: async () => {
    const { file, colors, algorithm, quantizedFor } = get();
    if (!file) return;
    if (
      quantizedFor?.file === file &&
      quantizedFor.colors === colors &&
      quantizedFor.algorithm === algorithm
    ) {
      return;
    }
    const signal = nextSignal();
    set({ status: 'quantizing', error: null });
    try {
      const quantized = await quantize(file, { colors, algorithm }, signal);
      // Overrides refer to palette indices of the previous result, so they are dropped.
      set({
        quantized,
        quantizedFor: { file, colors, algorithm },
        overrides: {},
        vectorized: null,
        status: 'idle',
      });
    } catch (error) {
      if (isAbort(error)) return;
      set({ status: 'idle', error: errorMessage(error) });
    }
  },

  runVectorize: async () => {
    const { quantized, overrides, tracing } = get();
    if (!quantized) return;
    const signal = nextSignal();
    set({ status: 'vectorizing', error: null });
    try {
      const image = base64ToBlob(quantized.image.data, quantized.image.media_type);
      const palette = finalPalette(quantized.palette, overrides);
      const vectorized = await vectorize(image, palette, tracing, signal);
      set({ vectorized, step: 'result', status: 'idle' });
    } catch (error) {
      if (isAbort(error)) return;
      set({ status: 'idle', error: errorMessage(error) });
    }
  },

  goTo: (step) => set({ step, error: null }),

  reset: () => {
    pending?.abort();
    set({ ...initialState, limits: get().limits });
  },
}));
