import type { StateCreator } from 'zustand';
import { findShape, parseSvg, type EditorDoc } from '../editor/model';
import { pathArea, shapesSmallerThan, uniteShapes, type Point } from '../editor/geometry';
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
import {
  shapesBounds,
  transformMatrix,
  transformShapes,
  translation,
  type SelectionTransform,
} from '../editor/transform';
import { placeFragment, type Fragment, type PlaceOptions } from '../lib/fragments';
import type { AppState } from './store';

/** SVG editor state of the result step (docs/08-svg-editor.md). */
export interface EditorState {
  /** Editable document built from `vectorized.svg`. */
  editor: EditorDoc | null;
  /** Ids of selected shapes. */
  selection: string[];
  /** Undo/redo snapshots of `editor`. */
  history: History;
  /** Neutral, non-error hint for the user (e.g. why an edit did nothing). */
  notice: string | null;
  /** Document last downloaded as SVG; edits after it are unsaved. */
  savedDoc: EditorDoc | null;
}

export interface EditorActions {
  select: (id: string | null, additive?: boolean) => void;
  /** Select several shapes at once (box selection); `additive` adds to the selection. */
  selectMany: (ids: string[], additive?: boolean) => void;
  selectAll: () => void;
  /** Select every shape smaller than `maxArea` (document px²), e.g. specks to delete. */
  selectSmallerThan: (maxArea: number) => void;
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
  /**
   * Move the selected shapes by a document offset. Repeated moves (arrow-key nudges)
   * are one undo step.
   */
  moveSelection: (dx: number, dy: number) => void;
  /** Scale, flip or rotate the selected shapes around their center. */
  transformSelection: (kind: SelectionTransform) => void;
  /** Place a saved fragment on top of the design; the placed shapes become the selection. */
  placeFragment: (fragment: Fragment, options: PlaceOptions) => void;
  undo: () => void;
  redo: () => void;
  /** Record that the current document was downloaded, so it has no unsaved edits. */
  markSaved: () => void;
}

export type EditorSlice = EditorState & EditorActions;

export const initialEditorState: EditorState = {
  editor: null,
  selection: [],
  history: emptyHistory,
  notice: null,
  savedDoc: null,
};

/** True when the document was edited since it was converted or last downloaded. */
export function hasUnsavedEdits(state: Pick<EditorState, 'editor' | 'history' | 'savedDoc'>) {
  return state.editor !== null && state.history.past.length > 0 && state.editor !== state.savedDoc;
}

/** Editor state for a newly vectorized SVG: nothing selected, no history. */
export function openDocument(
  svg: string,
): Pick<EditorState, 'editor' | 'selection' | 'history' | 'savedDoc'> {
  return { editor: parseSvg(svg), selection: [], history: emptyHistory, savedDoc: null };
}

/** Replace the editor document, recording the previous one for undo. */
function commit(
  state: EditorState,
  doc: EditorDoc,
  coalesceKey: string | null = null,
): Partial<EditorState> {
  if (!state.editor || doc === state.editor) return {};
  return { editor: doc, history: record(state.history, state.editor, coalesceKey), notice: null };
}

/** Apply an undo/redo step, keeping only selected shapes that still exist. */
function restore(state: EditorState, doc: EditorDoc, history: History): Partial<EditorState> {
  return {
    editor: doc,
    history,
    notice: null,
    selection: state.selection.filter((id) => findShape(doc, id) !== null),
  };
}

export const createEditorSlice: StateCreator<AppState, [], [], EditorSlice> = (set) => ({
  ...initialEditorState,

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

  selectSmallerThan: (maxArea) =>
    set((state) => {
      if (!state.editor) return {};
      const selection = shapesSmallerThan(state.editor, maxArea);
      return {
        selection,
        notice: selection.length ? null : `No shapes are smaller than ${maxArea} px².`,
      };
    }),

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

  moveSelection: (dx, dy) =>
    set((state) =>
      state.editor && state.selection.length && (dx || dy)
        ? commit(
            state,
            transformShapes(state.editor, state.selection, translation(dx, dy)),
            `move:${state.selection.join(',')}`,
          )
        : {},
    ),

  transformSelection: (kind) =>
    set((state) => {
      const bounds = state.editor && shapesBounds(state.editor, state.selection);
      if (!state.editor || !bounds) return {};
      const matrix = transformMatrix(kind, bounds);
      return commit(state, transformShapes(state.editor, state.selection, matrix));
    }),

  placeFragment: (fragment, options) =>
    set((state) => {
      if (!state.editor) return {};
      const placed = placeFragment(state.editor, fragment, options);
      return {
        ...commit(state, placed.doc),
        selection: placed.ids,
        notice: `Placed “${fragment.name}”: drag it into position, resize it in the inspector.`,
      };
    }),

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

  markSaved: () => set((state) => ({ savedDoc: state.editor })),
});
