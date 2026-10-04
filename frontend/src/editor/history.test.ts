import { describe, expect, it } from 'vitest';
import { COALESCE_MS, HISTORY_LIMIT, emptyHistory, record, redo, undo } from './history';
import type { EditorDoc } from './model';

const docAt = (n: number): EditorDoc => ({ width: n, height: n, groups: [] });

describe('history', () => {
  it('undoes and redoes in order', () => {
    let history = record(emptyHistory, docAt(1));
    history = record(history, docAt(2));
    let current = docAt(3);

    const first = undo(history, current)!;
    expect(first.doc).toEqual(docAt(2));
    current = first.doc;

    const second = undo(first.history, current)!;
    expect(second.doc).toEqual(docAt(1));
    expect(undo(second.history, second.doc)).toBeNull();

    const again = redo(second.history, second.doc)!;
    expect(again.doc).toEqual(docAt(2));
    expect(redo(again.history, again.doc)?.doc).toEqual(docAt(3));
  });

  it('clears the redo stack on a new commit', () => {
    const history = record(emptyHistory, docAt(1));
    const undone = undo(history, docAt(2))!;

    const next = record(undone.history, undone.doc);

    expect(next.future).toEqual([]);
    expect(redo(next, docAt(3))).toBeNull();
  });

  it('coalesces commits with the same key within the time window', () => {
    let history = record(emptyHistory, docAt(1), 'recolor', 0);
    history = record(history, docAt(2), 'recolor', COALESCE_MS - 1);
    expect(history.past).toEqual([docAt(1)]);

    history = record(history, docAt(3), 'recolor', 3 * COALESCE_MS);
    expect(history.past).toEqual([docAt(1), docAt(3)]);

    history = record(history, docAt(4), 'other', 3 * COALESCE_MS + 1);
    history = record(history, docAt(5), null, 3 * COALESCE_MS + 2);
    expect(history.past).toHaveLength(4);
    expect(history.last).toBeNull();
  });

  it('keeps at most HISTORY_LIMIT steps', () => {
    let history = emptyHistory;
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) history = record(history, docAt(i));

    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0]).toEqual(docAt(5));
  });
});
