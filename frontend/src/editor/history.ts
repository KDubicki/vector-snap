/**
 * Undo/redo history of immutable editor documents (FR-37).
 *
 * Documents are immutable and share unchanged groups/shapes, so snapshots are cheap.
 * Consecutive commits with the same `key` within `COALESCE_MS` (e.g. dragging a color
 * picker) are merged into one undo step.
 */
import type { EditorDoc } from './model';

export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 1000;

export interface History {
  past: EditorDoc[];
  future: EditorDoc[];
  /** Key and time of the last commit, for coalescing. */
  last: { key: string; at: number } | null;
}

export const emptyHistory: History = { past: [], future: [], last: null };

/** Record `previous` before it is replaced by a new document. */
export function record(
  history: History,
  previous: EditorDoc,
  key: string | null = null,
  now: number = Date.now(),
): History {
  const coalesce = key !== null && history.last?.key === key && now - history.last.at < COALESCE_MS;
  return {
    past: coalesce ? history.past : [...history.past, previous].slice(-HISTORY_LIMIT),
    future: [],
    last: key === null ? null : { key, at: now },
  };
}

export function undo(
  history: History,
  current: EditorDoc,
): { history: History; doc: EditorDoc } | null {
  const doc = history.past.at(-1);
  if (!doc) return null;
  return {
    doc,
    history: { past: history.past.slice(0, -1), future: [current, ...history.future], last: null },
  };
}

export function redo(
  history: History,
  current: EditorDoc,
): { history: History; doc: EditorDoc } | null {
  const [doc, ...future] = history.future;
  if (!doc) return null;
  return {
    doc,
    history: { past: [...history.past, current].slice(-HISTORY_LIMIT), future, last: null },
  };
}
