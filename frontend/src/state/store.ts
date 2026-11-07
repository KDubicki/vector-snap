import { create } from 'zustand';
import {
  errorMessage,
  getLimits,
  isUnreachable,
  quantize,
  suggestColors,
  vectorize,
} from '../api/client';
import { base64ToBlob } from '../lib/base64';
import { finalPalette } from '../lib/color';
import {
  ownedColors,
  readFilamentLibrary,
  saveFilamentLibrary,
  type FilamentLibrary,
} from '../lib/filamentLibrary';
import { fitImage, type Resize } from '../lib/fitImage';
import { DEFAULT_FORMATS, uploadFormats } from '../lib/imageFormats';
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
import { createPaletteSlice, initialPaletteState, type PaletteSlice } from './paletteSlice';
import { createPrintSlice, startPrint, type PrintSlice } from './printSlice';

export type Step = 'upload' | 'palette' | 'result' | 'print';
export type Status = 'idle' | 'quantizing' | 'vectorizing';

export const DEFAULT_COLORS = 8;
/** Light smoothing removes specks without rounding off real details. */
export const DEFAULT_SMOOTH = 1;
/** Colors under 2% of the image join their nearest: a gray speck is not worth a filament. */
export const DEFAULT_MIN_COVERAGE = 2;
/**
 * Colors under this CIEDE2000 difference become one: below 2 they differ only side by
 * side on a close look (#ffffff and #fefefe: 0.3), not worth two filaments.
 */
export const DEFAULT_MERGE_DELTA_E = 2;

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
  limits: Pick<
    Limits,
    'min_colors' | 'max_colors' | 'max_upload_mb' | 'max_image_dimension' | 'supported_formats'
  >;
  file: File | null;
  colors: number;
  algorithm: QuantizeAlgorithm;
  /** Strength of the region cleanup after quantization (0 = off). */
  smooth: number;
  /** Enlarge small images before quantizing (smoother traced outlines). */
  upscale: boolean;
  /** Colors covering less than this percentage of the image merge into their nearest. */
  minCoverage: number;
  /** Colors closer than this CIEDE2000 difference merge into one (0 = off). */
  mergeDeltaE: number;
  quantized: QuantizeResponse | null;
  /** Parameters that produced `quantized`; avoids re-quantizing (and losing edits) needlessly. */
  quantizedFor: {
    file: File;
    colors: number;
    algorithm: QuantizeAlgorithm;
    smooth: number;
    upscale: boolean;
    minCoverage: number;
    mergeDeltaE: number;
    locked: string[];
    /** Filament colors offered (`filaments` algorithm), joined; '' otherwise. */
    filaments: string;
  } | null;
  /** Filaments to choose the palette from (`filaments` algorithm); kept across images. */
  filamentLibrary: FilamentLibrary;
  /** Color count suggested for `file` by the backend, once requested. */
  suggestedColors: number | null;
  suggesting: boolean;
  tracing: TracingOptions;
  vectorized: VectorizeResponse | null;
  status: Status;
  error: string | null;
  /** Something the user should know that is not an error (an image scaled down). */
  notice: string | null;
  /** A chosen image is being read (and scaled down if the backend would refuse it). */
  preparingImage: boolean;

  loadLimits: () => Promise<void>;
  /** Take a chosen image: scaled down first when it is over the limits (`fitImage`). */
  chooseImage: (file: File) => Promise<void>;
  selectFile: (file: File) => void;
  setColors: (colors: number) => void;
  setAlgorithm: (algorithm: QuantizeAlgorithm) => void;
  setSmooth: (smooth: number) => void;
  setMinCoverage: (percent: number) => void;
  setMergeDeltaE: (deltaE: number) => void;
  setUpscale: (upscale: boolean) => void;
  /** Replace the filament library (stored in the browser). */
  setFilamentLibrary: (library: FilamentLibrary) => void;
  /** Ask the backend for a good color count for the current file and apply it. */
  suggestColors: () => Promise<void>;
  setTracing: (options: Partial<TracingOptions>) => void;
  resetTracing: () => void;
  runQuantize: () => Promise<void>;
  runVectorize: () => Promise<void>;
  /** Open a step; ignored when it is not reachable yet (see `reachableSteps`). */
  goTo: (step: Step) => void;
  reset: () => void;
}

export type AppState = WorkflowSlice & PaletteSlice & PrintSlice & EditorSlice & FragmentsSlice;

const initialState = {
  step: 'upload' as Step,
  limits: {
    min_colors: 2,
    max_colors: 64,
    max_upload_mb: 10,
    max_image_dimension: 4096,
    supported_formats: DEFAULT_FORMATS,
  },
  file: null,
  colors: DEFAULT_COLORS,
  algorithm: 'kmeans' as QuantizeAlgorithm,
  smooth: DEFAULT_SMOOTH,
  minCoverage: DEFAULT_MIN_COVERAGE,
  mergeDeltaE: DEFAULT_MERGE_DELTA_E,
  upscale: true,
  quantized: null,
  quantizedFor: null,
  suggestedColors: null as number | null,
  suggesting: false,
  ...initialPaletteState,
  tracing: DEFAULT_TRACING,
  vectorized: null,
  printUndo: null,
  ...initialEditorState,
  status: 'idle' as Status,
  error: null,
  notice: null,
  preparingImage: false,
};

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

let pending: AbortController | null = null;
// Separate from `pending`: a suggestion must not abort quantization (or vice versa), since
// an unchanged color count would never re-trigger the aborted quantization.
let pendingSuggestion: AbortController | null = null;

// The latest chosen image: one chosen while another is still being read wins.
let choosing = 0;

function resizeNotice(name: string, { width, height, toWidth, toHeight }: Resize): string {
  return (
    `${name} was scaled down from ${width} × ${height} to ${toWidth} × ${toHeight} px ` +
    'to fit the size limits of the server.'
  );
}

/** Abort the in-flight request (if any) and return a signal for the next one. */
function nextSignal(): AbortSignal {
  pending?.abort();
  pending = new AbortController();
  return pending.signal;
}

export const useAppStore = create<AppState>()((set, get, api) => ({
  ...createEditorSlice(set, get, api),
  ...createFragmentsSlice(set, get, api),
  ...createPaletteSlice(set, get, api),
  ...createPrintSlice(set, get, api),
  filamentLibrary: readFilamentLibrary(browserStorage()),
  ...initialState,

  loadLimits: async () => {
    try {
      const limits = await getLimits();
      // A field an older backend leaves out keeps its default.
      const merged = { ...initialState.limits, ...limits };
      set((state) => ({
        limits: { ...merged, supported_formats: uploadFormats(merged.supported_formats) },
        colors: Math.min(Math.max(state.colors, limits.min_colors), limits.max_colors),
      }));
    } catch (error) {
      // Keep defaults; the backend still validates every request. A server that cannot
      // be reached is said at once, before an image is chosen.
      if (isUnreachable(error)) set({ error: errorMessage(error) });
    }
  },

  chooseImage: async (file) => {
    const token = (choosing += 1);
    const { max_upload_mb, max_image_dimension } = get().limits;
    set({ preparingImage: true });
    const fitted = await fitImage(file, {
      maxDimension: max_image_dimension,
      maxBytes: max_upload_mb * 1024 * 1024,
    });
    if (token !== choosing) return;
    set({ preparingImage: false });
    get().selectFile(fitted.file);
    if (fitted.resized && get().file === fitted.file) {
      set({ notice: resizeNotice(file.name, fitted.resized) });
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
      background: null,
      vectorized: null,
      error: null,
      notice: null,
    });
  },

  setColors: (colors) => set((state) => ({ colors: Math.max(colors, state.locked.length) })),
  setAlgorithm: (algorithm) => set({ algorithm }),
  setSmooth: (smooth) => set({ smooth }),
  setMinCoverage: (minCoverage) => set({ minCoverage }),
  setMergeDeltaE: (mergeDeltaE) => set({ mergeDeltaE }),
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

  setTracing: (options) => set((state) => ({ tracing: { ...state.tracing, ...options } })),
  resetTracing: () => set({ tracing: DEFAULT_TRACING }),

  runQuantize: async () => {
    const { file, colors, algorithm, smooth, upscale, minCoverage, mergeDeltaE, locked } = get();
    const { quantizedFor } = get();
    if (!file) return;
    const offered = algorithm === 'filaments' ? ownedColors(get().filamentLibrary) : [];
    const filaments = offered.join(',');
    if (
      quantizedFor?.file === file &&
      quantizedFor.colors === colors &&
      quantizedFor.algorithm === algorithm &&
      quantizedFor.smooth === smooth &&
      quantizedFor.minCoverage === minCoverage &&
      quantizedFor.mergeDeltaE === mergeDeltaE &&
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
        {
          colors,
          algorithm,
          smooth,
          upscale,
          locked_colors: locked,
          filaments: offered,
          min_coverage: minCoverage / 100,
          merge_delta_e: mergeDeltaE,
        },
        signal,
      );
      // Overrides refer to palette indices of the previous result, so they are dropped.
      set({
        quantized,
        quantizedFor: {
          file,
          colors,
          algorithm,
          smooth,
          upscale,
          minCoverage,
          mergeDeltaE,
          locked,
          filaments,
        },
        overrides: {},
        transparent: [],
        background: null,
        vectorized: null,
        status: 'idle',
      });
    } catch (error) {
      if (isAbort(error)) return;
      set({ status: 'idle', error: errorMessage(error) });
    }
  },

  runVectorize: async () => {
    const { quantized, overrides, transparent, background, tracing } = get();
    if (!quantized) return;
    const signal = nextSignal();
    set({ status: 'vectorizing', error: null });
    try {
      const image = base64ToBlob(quantized.image.data, quantized.image.media_type);
      const palette = finalPalette(quantized.palette, overrides);
      const vectorized = await vectorize(
        image,
        palette,
        { ...tracing, transparent, background: background === null ? [] : [background] },
        signal,
      );
      set((state) => ({
        vectorized,
        ...openDocument(vectorized.svg),
        // Palette indices and shape ids belong to the previous SVG.
        print: { ...state.print, colorRaise: {}, excluded: [], shapeRaise: {} },
        printUndo: null, // it would bring back the old design's colors and raises
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

  reset: () => {
    pending?.abort();
    pendingSuggestion?.abort();
    set({ ...initialState, print: startPrint(), limits: get().limits });
  },
}));
