/**
 * Colors of the editor document that look the same, and merging them into one.
 *
 * The same CIEDE2000 scale as the palette step (`merge_delta_e` of `/quantize`): two
 * color groups closer than the limit — #ffffff and #fefefe — print as two filaments
 * nobody can tell apart, so the smaller one joins the one covering more. Shapes with
 * their own color that looks like their group's color follow the group again. See
 * docs/08-svg-editor.md#similar-colors.
 */
import { deltaE2000 } from '../lib/color';
import { pathArea } from './geometry';
import type { ColorGroup, EditorDoc, Shape } from './model';

export interface SimilarGroup {
  paletteIndex: number;
  fill: string;
  /** Group it joins (after following chains: a → b → c joins c). */
  intoIndex: number;
  intoFill: string;
  deltaE: number;
}

export interface SimilarColors {
  groups: SimilarGroup[];
  /** Ids of shapes whose own color looks like their group's color. */
  shapes: string[];
}

const groupArea = (group: ColorGroup) =>
  group.shapes.reduce((total, shape) => total + pathArea(shape.d), 0);

/** Groups to merge, closest pair first; the group covering more stays. */
function similarGroups(
  doc: EditorDoc,
  maxDeltaE: number,
  area: (group: ColorGroup) => number,
): SimilarGroup[] {
  const alive = doc.groups.map((group) => ({ group, weight: -1 }));
  const into = new Map<number, number>(); // index in doc.groups → index it joins
  for (;;) {
    let best: [number, number, number] | null = null;
    for (let i = 0; i < alive.length; i += 1) {
      if (into.has(i)) continue;
      for (let j = i + 1; j < alive.length; j += 1) {
        if (into.has(j)) continue;
        const distance = deltaE2000(alive[i].group.fill, alive[j].group.fill);
        if (distance < maxDeltaE && (!best || distance < best[2])) best = [i, j, distance];
      }
    }
    if (!best) break;
    const [i, j] = best;
    for (const k of [i, j]) if (alive[k].weight < 0) alive[k].weight = area(alive[k].group);
    // Ties keep the lower group: usually the background the rest lies on.
    const [kept, merged] = alive[j].weight > alive[i].weight ? [j, i] : [i, j];
    into.set(merged, kept);
    alive[kept].weight += alive[merged].weight;
  }
  return [...into.keys()].map((index) => {
    let target = into.get(index)!;
    while (into.has(target)) target = into.get(target)!;
    const { paletteIndex, fill } = doc.groups[index];
    const intoGroup = doc.groups[target];
    return {
      paletteIndex,
      fill,
      intoIndex: intoGroup.paletteIndex,
      intoFill: intoGroup.fill,
      deltaE: deltaE2000(fill, intoGroup.fill),
    };
  });
}

/** Group fill of every palette index once `groups` are merged. */
function fillsAfter(doc: EditorDoc, groups: SimilarGroup[]): Map<number, string> {
  const fills = new Map(doc.groups.map((group) => [group.paletteIndex, group.fill]));
  for (const group of groups) fills.set(group.paletteIndex, group.intoFill);
  return fills;
}

/** Colors of `doc` closer than `maxDeltaE` (CIEDE2000); nothing for a limit of 0. */
export function findSimilarColors(
  doc: EditorDoc,
  maxDeltaE: number,
  area: (group: ColorGroup) => number = groupArea,
): SimilarColors {
  if (maxDeltaE <= 0) return { groups: [], shapes: [] };
  const groups = similarGroups(doc, maxDeltaE, area);
  const fills = fillsAfter(doc, groups);
  const shapes = doc.groups.flatMap((group) => {
    const fill = fills.get(group.paletteIndex)!;
    return group.shapes
      .filter((shape) => shape.fill && deltaE2000(shape.fill, fill) < maxDeltaE)
      .map((shape) => shape.id);
  });
  return { groups, shapes };
}

function withoutFill(shape: Shape): Shape {
  const copy = { ...shape };
  delete copy.fill;
  return copy;
}

/**
 * Merge what `findSimilarColors` found: the shapes of a merged group move on top of the
 * group it joins (keeping their own colors), the listed own colors are dropped.
 */
export function mergeSimilarColors(doc: EditorDoc, similar: SimilarColors): EditorDoc {
  if (!similar.groups.length && !similar.shapes.length) return doc;
  const into = new Map(similar.groups.map((group) => [group.paletteIndex, group.intoIndex]));
  const following = new Set(similar.shapes);
  const fills = fillsAfter(doc, similar.groups);
  const follow = (shape: Shape, fill: string) =>
    following.has(shape.id) || shape.fill === fill ? withoutFill(shape) : shape;
  const moved = new Map<number, Shape[]>();
  for (const group of doc.groups) {
    const target = into.get(group.paletteIndex);
    if (target === undefined) continue;
    const fill = fills.get(target)!;
    moved.set(target, [
      ...(moved.get(target) ?? []),
      ...group.shapes.map((shape) => follow(shape, fill)),
    ]);
  }
  return {
    ...doc,
    groups: doc.groups
      .filter((group) => !into.has(group.paletteIndex))
      .map((group) => ({
        ...group,
        shapes: [
          ...group.shapes.map((shape) => follow(shape, group.fill)),
          ...(moved.get(group.paletteIndex) ?? []),
        ],
      })),
  };
}
