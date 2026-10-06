import { create } from 'zustand';
import { ApiError, getLimits, quantize, vectorize } from '../api/client';
import { findShape, parseSvg, type EditorDoc } from '../editor/model';
import { pathArea, uniteShapes, type Point } from '../editor/geometry';
import { emptyHistory, record, redo, undo, type History } from '../editor/history';
import {
  deleteShapes,
  mergeShapes,
  moveShapesToGroup,
  recolorGroup,
  recolorShapes,
  resetShapeColors,
} from '../editor/operations';
import { cutWithRegion, splitAlongLine } from '../editor/split';
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

export type Step = 'upload' | 'palette' | 'result';
export type Status = 'idle' | 'quantizing' | 'vectorizing';

export const DEFAULT_COLORS = 8;
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
  /** Editable document built from `vectorized.svg`. */
  editor: EditorDoc | null;
  /** Ids of selected shapes. */
  selection: string[];
  /** Undo/redo snapshots of `editor`. */
  history: History;
  /** Neutral, non-error hint for the user (e.g. why an edit did nothing). */
  notice: string | null;
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
  resetTracing: () => void;
  runQuantize: () => Promise<void>;
  runVectorize: () => Promise<void>;
  select: (id: string | null, additive?: boolean) => void;
  /** Select several shapes at once (box selection); `additive` adds to the selection. */
  selectMany: (ids: string[], additive?: boolean) => void;
  selectAll: () => void;
  recolorSelection: (fill: string) => void;
  resetSelectionColor: () => void;
  recolorGroup: (paletteIndex: number, fill: string) => void;
  /** Split fully crossed shapes (the selection, if any) along a line in document coordinates. */
  splitWithLine: (line: Point[]) => void;
  /**
   * Cut a lasso region out of the selected shapes, or — without a selection — out of the
   * shape the lasso started on (`startId`). The inside pieces become the selection.
   */
  cutWithLasso: (region: Point[], startId: string | null) => void;
  deleteSelection: () => void;
  /** Merge the selected shapes into one taking the color/group of the largest (FR-35). */
  mergeSelection: () => void;
  /** Move the selected shapes into another color group. */
  moveSelectionToGroup: (paletteIndex: number) => void;
  undo: () => void;
  redo: () => void;
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
  editor: null as EditorDoc | null,
  selection: [] as string[],
  history: emptyHistory,
  notice: null as string | null,
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

/** Replace the editor document, recording the previous one for undo. */
function commit(
  state: AppState,
  doc: EditorDoc,
  coalesceKey: string | null = null,
): Partial<AppState> {
  if (!state.editor || doc === state.editor) return {};
  return { editor: doc, history: record(state.history, state.editor, coalesceKey), notice: null };
}

/** Apply an undo/redo step, keeping only selected shapes that still exist. */
function restore(state: AppState, doc: EditorDoc, history: History): Partial<AppState> {
  return {
    editor: doc,
    history,
    notice: null,
    selection: state.selection.filter((id) => findShape(doc, id) !== null),
  };
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
  resetTracing: () => set({ tracing: DEFAULT_TRACING }),

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
      set({
        vectorized,
        editor: parseSvg(vectorized.svg),
        selection: [],
        history: emptyHistory,
        step: 'result',
        status: 'idle',
      });
    } catch (error) {
      if (isAbort(error)) return;
      set({ status: 'idle', error: errorMessage(error) });
    }
  },

  select: (id, additive = false) =>
    set((state) => {
      if (id === null || !state.editor || !findShape(state.editor, id)) {
        return { selection: additive ? state.selection : [], notice: null };
      }
      if (!additive) return { selection: [id], notice: null };
      return {
        notice: null,
        selection: state.selection.includes(id)
          ? state.selection.filter((selected) => selected !== id)
          : [...state.selection, id],
      };
    }),

  selectMany: (ids, additive = false) =>
    set((state) => {
      if (!state.editor) return {};
      const known = ids.filter((id) => findShape(state.editor!, id) !== null);
      const base = additive ? state.selection : [];
      return { selection: [...new Set([...base, ...known])], notice: null };
    }),

  selectAll: () =>
    set((state) => ({
      selection: state.editor
        ? state.editor.groups.flatMap((group) => group.shapes.map((shape) => shape.id))
        : [],
      notice: null,
    })),

  recolorSelection: (fill) =>
    set((state) =>
      state.editor && state.selection.length
        ? commit(
            state,
            recolorShapes(state.editor, state.selection, fill),
            `recolor:${state.selection.join(',')}`,
          )
        : {},
    ),

  resetSelectionColor: () =>
    set((state) =>
      state.editor && state.selection.length
        ? commit(state, resetShapeColors(state.editor, state.selection))
        : {},
    ),

  recolorGroup: (paletteIndex, fill) =>
    set((state) =>
      state.editor
        ? commit(
            state,
            recolorGroup(state.editor, paletteIndex, fill),
            `recolor-group:${paletteIndex}`,
          )
        : {},
    ),

  splitWithLine: (line) =>
    set((state) => {
      if (!state.editor) return {};
      const result = splitAlongLine(state.editor, line, state.selection);
      if (result.split === 0) {
        return { notice: 'Draw a line that fully crosses a shape to split it.' };
      }
      return { ...commit(state, result.doc), selection: result.created };
    }),

  cutWithLasso: (region, startId) =>
    set((state) => {
      if (!state.editor) return {};
      const targets = state.selection.length ? state.selection : startId ? [startId] : [];
      if (!targets.length) {
        return { notice: 'Start the lasso on a shape, or select the shapes to cut first.' };
      }
      const result = cutWithRegion(state.editor, region, targets);
      if (result.cut === 0) {
        return { notice: 'Draw the lasso over part of the shape, not around all of it.' };
      }
      return { ...commit(state, result.doc), selection: result.inside };
    }),

  deleteSelection: () =>
    set((state) =>
      state.editor && state.selection.length
        ? { ...commit(state, deleteShapes(state.editor, state.selection)), selection: [] }
        : {},
    ),

  mergeSelection: () =>
    set((state) => {
      if (!state.editor) return {};
      const doc = state.editor;
      const shapes = doc.groups
        .flatMap((group) => group.shapes)
        .filter((shape) => state.selection.includes(shape.id));
      if (shapes.length < 2) return { notice: 'Select at least two shapes to merge.' };
      const largest = shapes.reduce((best, shape) =>
        pathArea(shape.d) > pathArea(best.d) ? shape : best,
      );
      const merged = mergeShapes(
        doc,
        shapes.map((shape) => shape.id),
        largest.id,
        uniteShapes(shapes.map((shape) => shape.d)),
      );
      return { ...commit(state, merged), selection: [largest.id] };
    }),

  moveSelectionToGroup: (paletteIndex) =>
    set((state) =>
      state.editor && state.selection.length
        ? commit(state, moveShapesToGroup(state.editor, state.selection, paletteIndex))
        : {},
    ),

  undo: () =>
    set((state) => {
      const step = state.editor && undo(state.history, state.editor);
      return step ? restore(state, step.doc, step.history) : {};
    }),

  redo: () =>
    set((state) => {
      const step = state.editor && redo(state.history, state.editor);
      return step ? restore(state, step.doc, step.history) : {};
    }),

  goTo: (step) => set({ step, error: null }),

  reset: () => {
    pending?.abort();
    set({ ...initialState, limits: get().limits });
  },
}));
