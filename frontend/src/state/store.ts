import { create } from 'zustand';
import { errorMessage, getLimits, quantize, suggestColors, vectorize } from '../api/client';
import { base64ToBlob } from '../lib/base64';
import { finalPalette } from '../lib/color';
import { DEFAULT_TRACING } from '../lib/tracing';
import type {
  Limits,
  QuantizeAlgorithm,
  QuantizeResponse,
  TracingOptions,
  VectorizeResponse,
} from '../types/api';
import {
  createEditorSlice,
  initialEditorState,
  openDocument,
  type EditorSlice,
} from './editorSlice';

export type Step = 'upload' | 'palette' | 'result';
export type Status = 'idle' | 'quantizing' | 'vectorizing';

export const DEFAULT_COLORS = 8;

export const STEPS: Step[] = ['upload', 'palette', 'result'];

/** Steps the user can open now: colors need an image, the SVG step a converted result. */
export function reachableSteps(state: Pick<AppState, 'file' | 'vectorized' | 'editor'>): Step[] {
  return STEPS.filter(
    (step) =>
      step === 'upload' ||
      (step === 'palette' && state.file !== null) ||
      (step === 'result' && state.vectorized !== null && state.editor !== null),
  );
}

/** Conversion workflow: upload, colors and palette, tracing (docs/07-frontend.md). */
export interface WorkflowSlice {
  step: Step;
  limits: Pick<Limits, 'min_colors' | 'max_colors' | 'max_upload_mb'>;
  file: File | null;
  colors: number;
  algorithm: QuantizeAlgorithm;
  quantized: QuantizeResponse | null;
  /** Parameters that produced `quantized`; avoids re-quantizing (and losing edits) needlessly. */
  quantizedFor: {
    file: File;
    colors: number;
    algorithm: QuantizeAlgorithm;
    locked: string[];
  } | null;
  /** Color count suggested for `file` by the backend, once requested. */
  suggestedColors: number | null;
  suggesting: boolean;
  /** Colors that must appear exactly in the palette (FR-16); at most `colors` of them. */
  locked: string[];
  overrides: Record<number, string>;
  /** Palette indices left out of the SVG (e.g. a removed background). */
  transparent: number[];
  tracing: TracingOptions;
  vectorized: VectorizeResponse | null;
  status: Status;
  error: string | null;

  loadLimits: () => Promise<void>;
  selectFile: (file: File) => void;
  setColors: (colors: number) => void;
  setAlgorithm: (algorithm: QuantizeAlgorithm) => void;
  /** Ask the backend for a good color count for the current file and apply it. */
  suggestColors: () => Promise<void>;
  /** Lock a color into the palette; ignored when it is locked already or no slot is free. */
  lockColor: (hex: string) => void;
  unlockColor: (hex: string) => void;
  setOverride: (index: number, hex: string) => void;
  resetOverride: (index: number) => void;
  resetOverrides: () => void;
  /** Toggle whether a palette color is left out; at least one color always stays. */
  toggleTransparent: (index: number) => void;
  setTracing: (options: Partial<TracingOptions>) => void;
  resetTracing: () => void;
  runQuantize: () => Promise<void>;
  runVectorize: () => Promise<void>;
  /** Open a step; ignored when it is not reachable yet (see `reachableSteps`). */
  goTo: (step: Step) => void;
  reset: () => void;
}

export type AppState = WorkflowSlice & EditorSlice;

const initialState = {
  step: 'upload' as Step,
  limits: { min_colors: 2, max_colors: 64, max_upload_mb: 10 },
  file: null,
  colors: DEFAULT_COLORS,
  algorithm: 'kmeans' as QuantizeAlgorithm,
  quantized: null,
  quantizedFor: null,
  suggestedColors: null as number | null,
  suggesting: false,
  locked: [] as string[],
  overrides: {},
  transparent: [] as number[],
  tracing: DEFAULT_TRACING,
  vectorized: null,
  ...initialEditorState,
  status: 'idle' as Status,
  error: null,
};

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

let pending: AbortController | null = null;
// Separate from `pending`: a suggestion must not abort quantization (or vice versa), since
// an unchanged color count would never re-trigger the aborted quantization.
let pendingSuggestion: AbortController | null = null;

/** Abort the in-flight request (if any) and return a signal for the next one. */
function nextSignal(): AbortSignal {
  pending?.abort();
  pending = new AbortController();
  return pending.signal;
}

export const useAppStore = create<AppState>()((set, get, api) => ({
  ...createEditorSlice(set, get, api),
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
    pendingSuggestion?.abort();
    set({
      file,
      suggesting: false,
      step: 'palette',
      quantized: null,
      quantizedFor: null,
      suggestedColors: null,
      overrides: {},
      transparent: [],
      vectorized: null,
      error: null,
    });
  },

  setColors: (colors) => set((state) => ({ colors: Math.max(colors, state.locked.length) })),
  setAlgorithm: (algorithm) => set({ algorithm }),

  suggestColors: async () => {
    const { file } = get();
    if (!file) return;
    pendingSuggestion?.abort();
    const controller = new AbortController();
    pendingSuggestion = controller;
    set({ suggesting: true, error: null });
    try {
      const suggestion = await suggestColors(file, controller.signal);
      set((state) => {
        const { min_colors, max_colors } = state.limits;
        const colors = Math.min(
          Math.max(suggestion.colors, min_colors, state.locked.length),
          max_colors,
        );
        return { colors, suggestedColors: colors, suggesting: false };
      });
    } catch (error) {
      if (isAbort(error)) return;
      set({ suggesting: false, error: errorMessage(error) });
    } finally {
      if (pendingSuggestion === controller) pendingSuggestion = null;
    }
  },

  lockColor: (hex) =>
    set((state) => {
      const color = hex.toLowerCase();
      if (state.locked.includes(color) || state.locked.length >= state.colors) return {};
      return { locked: [...state.locked, color] };
    }),
  unlockColor: (hex) =>
    set((state) => {
      const color = hex.toLowerCase();
      return state.locked.includes(color)
        ? { locked: state.locked.filter((locked) => locked !== color) }
        : {};
    }),

  setOverride: (index, hex) =>
    set((state) => ({ overrides: { ...state.overrides, [index]: hex.toLowerCase() } })),
  resetOverride: (index) =>
    set((state) => {
      const overrides = { ...state.overrides };
      delete overrides[index];
      return { overrides };
    }),
  resetOverrides: () => set({ overrides: {} }),

  toggleTransparent: (index) =>
    set((state) => {
      if (state.transparent.includes(index)) {
        return { transparent: state.transparent.filter((value) => value !== index) };
      }
      const colors = state.quantized?.palette.length ?? 0;
      if (state.transparent.length + 1 >= colors) return {};
      return { transparent: [...state.transparent, index].sort((a, b) => a - b) };
    }),

  setTracing: (options) => set((state) => ({ tracing: { ...state.tracing, ...options } })),
  resetTracing: () => set({ tracing: DEFAULT_TRACING }),

  runQuantize: async () => {
    const { file, colors, algorithm, locked, quantizedFor } = get();
    if (!file) return;
    if (
      quantizedFor?.file === file &&
      quantizedFor.colors === colors &&
      quantizedFor.algorithm === algorithm &&
      quantizedFor.locked === locked
    ) {
      return;
    }
    const signal = nextSignal();
    set({ status: 'quantizing', error: null });
    try {
      const quantized = await quantize(file, { colors, algorithm, locked_colors: locked }, signal);
      // Overrides refer to palette indices of the previous result, so they are dropped.
      set({
        quantized,
        quantizedFor: { file, colors, algorithm, locked },
        overrides: {},
        transparent: [],
        vectorized: null,
        status: 'idle',
      });
    } catch (error) {
      if (isAbort(error)) return;
      set({ status: 'idle', error: errorMessage(error) });
    }
  },

  runVectorize: async () => {
    const { quantized, overrides, transparent, tracing } = get();
    if (!quantized) return;
    const signal = nextSignal();
    set({ status: 'vectorizing', error: null });
    try {
      const image = base64ToBlob(quantized.image.data, quantized.image.media_type);
      const palette = finalPalette(quantized.palette, overrides);
      const vectorized = await vectorize(image, palette, { ...tracing, transparent }, signal);
      set({
        vectorized,
        ...openDocument(vectorized.svg),
        step: 'result',
        status: 'idle',
      });
    } catch (error) {
      if (isAbort(error)) return;
      set({ status: 'idle', error: errorMessage(error) });
    }
  },

  goTo: (step) => {
    if (reachableSteps(get()).includes(step)) set({ step, error: null });
  },

  reset: () => {
    pending?.abort();
    pendingSuggestion?.abort();
    set({ ...initialState, limits: get().limits });
  },
}));
