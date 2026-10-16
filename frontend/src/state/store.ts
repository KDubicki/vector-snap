import { create } from 'zustand';
import { errorMessage, getLimits, quantize, suggestColors, vectorize } from '../api/client';
import { base64ToBlob } from '../lib/base64';
import { finalPalette } from '../lib/color';
import {
  ownedColors,
  readFilamentLibrary,
  saveFilamentLibrary,
  type FilamentLibrary,
} from '../lib/filamentLibrary';
import {
  DEFAULT_PRINT,
  KEPT_BY_PROJECTS,
  applyProject,
  type PrintSettings,
  type ProjectId,
} from '../lib/printPlan';
import { PRINTER_FIELDS, printerOf, readPrinter, savePrinter } from '../lib/printerProfile';
import { browserStorage } from '../lib/theme';
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
import { createFragmentsSlice, type FragmentsSlice } from './fragmentsSlice';

export type Step = 'upload' | 'palette' | 'result' | 'print';
export type Status = 'idle' | 'quantizing' | 'vectorizing';

export const DEFAULT_COLORS = 8;
/** Light smoothing removes specks without rounding off real details. */
export const DEFAULT_SMOOTH = 1;

export const STEPS: Step[] = ['upload', 'palette', 'result', 'print'];

/** Steps the user can open now: colors need an image, the SVG and 3D print steps a
 * converted result. */
export function reachableSteps(state: Pick<AppState, 'file' | 'vectorized' | 'editor'>): Step[] {
  return STEPS.filter(
    (step) =>
      step === 'upload' ||
      (step === 'palette' && state.file !== null) ||
      ((step === 'result' || step === 'print') &&
        state.vectorized !== null &&
        state.editor !== null),
  );
}

/** Conversion workflow: upload, colors and palette, tracing (docs/07-frontend.md). */
export interface WorkflowSlice {
  step: Step;
  limits: Pick<Limits, 'min_colors' | 'max_colors' | 'max_upload_mb'>;
  file: File | null;
  colors: number;
  algorithm: QuantizeAlgorithm;
  /** Strength of the region cleanup after quantization (0 = off). */
  smooth: number;
  /** Enlarge small images before quantizing (smoother traced outlines). */
  upscale: boolean;
  quantized: QuantizeResponse | null;
  /** Parameters that produced `quantized`; avoids re-quantizing (and losing edits) needlessly. */
  quantizedFor: {
    file: File;
    colors: number;
    algorithm: QuantizeAlgorithm;
    smooth: number;
    upscale: boolean;
    locked: string[];
    /** Filament colors offered (`filaments` algorithm), joined; '' otherwise. */
    filaments: string;
  } | null;
  /** Filaments to choose the palette from (`filaments` algorithm); kept across images. */
  filamentLibrary: FilamentLibrary;
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
  /** 3D print step settings (docs/07-frontend.md); colors and raises reset per SVG. */
  print: PrintSettings;
  status: Status;
  error: string | null;

  loadLimits: () => Promise<void>;
  selectFile: (file: File) => void;
  setColors: (colors: number) => void;
  setAlgorithm: (algorithm: QuantizeAlgorithm) => void;
  setSmooth: (smooth: number) => void;
  setUpscale: (upscale: boolean) => void;
  /** Replace the filament library (stored in the browser). */
  setFilamentLibrary: (library: FilamentLibrary) => void;
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
  setPrint: (change: Partial<PrintSettings>) => void;
  /** Apply a project preset (magnet, keychain, …); colors and raised elements stay. */
  chooseProject: (id: ProjectId) => void;
  reset: () => void;
}

export type AppState = WorkflowSlice & EditorSlice & FragmentsSlice;

const initialState = {
  step: 'upload' as Step,
  limits: { min_colors: 2, max_colors: 64, max_upload_mb: 10 },
  file: null,
  colors: DEFAULT_COLORS,
  algorithm: 'kmeans' as QuantizeAlgorithm,
  smooth: DEFAULT_SMOOTH,
  upscale: true,
  quantized: null,
  quantizedFor: null,
  suggestedColors: null as number | null,
  suggesting: false,
  locked: [] as string[],
  overrides: {},
  transparent: [] as number[],
  tracing: DEFAULT_TRACING,
  vectorized: null,
  print: DEFAULT_PRINT,
  ...initialEditorState,
  status: 'idle' as Status,
  error: null,
};

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** Print settings that are not part of a project preset. */
const KEPT_SETTINGS = new Set<string>(KEPT_BY_PROJECTS);

/** New designs start with the printer remembered in this browser. */
function startPrint(): PrintSettings {
  return { ...DEFAULT_PRINT, ...readPrinter(browserStorage()) };
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
  ...createFragmentsSlice(set, get, api),
  filamentLibrary: readFilamentLibrary(browserStorage()),
  ...initialState,
  print: startPrint(),

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
  setSmooth: (smooth) => set({ smooth }),
  setUpscale: (upscale) => set({ upscale }),
  setFilamentLibrary: (filamentLibrary) => {
    saveFilamentLibrary(browserStorage(), filamentLibrary);
    set({ filamentLibrary });
  },

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
    const { file, colors, algorithm, smooth, upscale, locked, quantizedFor } = get();
    if (!file) return;
    const offered = algorithm === 'filaments' ? ownedColors(get().filamentLibrary) : [];
    const filaments = offered.join(',');
    if (
      quantizedFor?.file === file &&
      quantizedFor.colors === colors &&
      quantizedFor.algorithm === algorithm &&
      quantizedFor.smooth === smooth &&
      quantizedFor.upscale === upscale &&
      quantizedFor.locked === locked &&
      quantizedFor.filaments === filaments
    ) {
      return;
    }
    if (algorithm === 'filaments' && !offered.length) {
      set({ error: 'Choose at least one filament to pick the colors from.' });
      return;
    }
    const signal = nextSignal();
    set({ status: 'quantizing', error: null });
    try {
      const quantized = await quantize(
        file,
        { colors, algorithm, smooth, upscale, locked_colors: locked, filaments: offered },
        signal,
      );
      // Overrides refer to palette indices of the previous result, so they are dropped.
      set({
        quantized,
        quantizedFor: { file, colors, algorithm, smooth, upscale, locked, filaments },
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
      set((state) => ({
        vectorized,
        ...openDocument(vectorized.svg),
        // Palette indices and shape ids belong to the previous SVG.
        print: { ...state.print, colorRaise: {}, excluded: [], shapeRaise: {} },
        step: 'result',
        status: 'idle',
      }));
    } catch (error) {
      if (isAbort(error)) return;
      set({ status: 'idle', error: errorMessage(error) });
    }
  },

  goTo: (step) => {
    if (reachableSteps(get()).includes(step)) set({ step, error: null });
  },

  setPrint: (change) =>
    set((state) => {
      // Editing what a project sets (sizes, base, loop, …) makes the settings custom.
      const custom = Object.keys(change).some((key) => !KEPT_SETTINGS.has(key));
      const print = { ...state.print, ...change, ...(custom && { project: 'custom' as const }) };
      if (Object.keys(change).some((key) => PRINTER_FIELDS.includes(key))) {
        savePrinter(browserStorage(), printerOf(print));
      }
      return { print };
    }),
  chooseProject: (id) => set((state) => ({ print: applyProject(state.print, id) })),

  reset: () => {
    pending?.abort();
    pendingSuggestion?.abort();
    set({ ...initialState, print: startPrint(), limits: get().limits });
  },
}));
