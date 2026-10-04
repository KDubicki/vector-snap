import { cutRegion, splitShape, type Point } from './geometry';
import type { EditorDoc } from './model';
import { replaceShape } from './operations';

export interface SplitResult {
  doc: EditorDoc;
  /** Ids of all created parts. */
  created: string[];
  /** Number of shapes that were split. */
  split: number;
}

/**
 * Split shapes along a line (FR-31). Only shapes the line fully crosses are split, so the
 * shape the line starts or ends on (typically the background) stays intact. When the line
 * crosses any of the `candidates` (the selection), only those are split; otherwise every
 * fully crossed shape is.
 */
export function splitAlongLine(doc: EditorDoc, line: Point[], candidates: string[]): SplitResult {
  if (candidates.length) {
    const restricted = splitShapes(doc, line, new Set(candidates));
    if (restricted.split > 0) return restricted;
  }
  return splitShapes(doc, line, null);
}

function splitShapes(doc: EditorDoc, line: Point[], allowed: Set<string> | null): SplitResult {
  let current = doc;
  const created: string[] = [];
  let split = 0;

  for (const group of doc.groups) {
    for (const shape of group.shapes) {
      if (allowed && !allowed.has(shape.id)) continue;
      const parts = splitShape(shape.d, line);
      if (!parts) continue;
      const result = replaceShape(current, shape.id, parts);
      current = result.doc;
      created.push(...result.ids);
      split += 1;
    }
  }
  return { doc: current, created, split };
}

export interface RegionCutResult {
  doc: EditorDoc;
  /** Ids of the pieces inside the region (to be selected). */
  inside: string[];
  /** Number of shapes that were cut. */
  cut: number;
}

/**
 * Cut the `targets` with a closed lasso region (FR-32): each target that the region covers
 * partly is replaced by its pieces inside and outside the region, at the same z-position.
 */
export function cutWithRegion(doc: EditorDoc, region: Point[], targets: string[]): RegionCutResult {
  const wanted = new Set(targets);
  let current = doc;
  const inside: string[] = [];
  let cut = 0;

  for (const group of doc.groups) {
    for (const shape of group.shapes) {
      if (!wanted.has(shape.id)) continue;
      const pieces = cutRegion(shape.d, region);
      if (!pieces) continue;
      const result = replaceShape(current, shape.id, [...pieces.inside, ...pieces.outside]);
      current = result.doc;
      inside.push(...result.ids.slice(0, pieces.inside.length));
      cut += 1;
    }
  }
  return { doc: current, inside, cut };
}
