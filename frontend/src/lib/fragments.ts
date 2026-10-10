/**
 * Fragments: parts of a design (selected shapes with their colors) saved in a library,
 * to be placed later on another image. Stored per browser; the page works without
 * storage (private mode, blocked data), fragments then last until the page is closed.
 * See docs/08-svg-editor.md#fragments.
 */
import { serializeSvg } from '../editor/export';
import { transformPath } from '../editor/geometry';
import { shapeFill, type ColorGroup, type EditorDoc } from '../editor/model';
import { nearestColor } from './color';
import { shapesBounds, transformShapes, translation } from '../editor/transform';

export const FRAGMENTS_STORAGE_KEY = 'vectorsnap.fragments';
export const MAX_NAME_LENGTH = 60;
export const LIBRARY_FORMAT = 'vectorsnap-fragments';
export const LIBRARY_FILE_NAME = 'vectorsnap-fragments.json';
/** A placed fragment larger than this share of the image is scaled down to it. */
export const PLACE_MAX_SHARE = 0.5;

export interface FragmentShape {
  /** Path data with the fragment's top-left corner at (0, 0). */
  d: string;
  fill: string;
}

export interface Fragment {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Bottom to top, as in the design they came from. */
  shapes: FragmentShape[];
  /** ISO time of saving. */
  createdAt: string;
}

/** Short unique id; `crypto.randomUUID` is missing on plain-HTTP (non-localhost) pages. */
export function fragmentId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Name for a new fragment: "Fragment 3" after "Fragment 1" and "Fragment 2". */
export function nextFragmentName(fragments: Pick<Fragment, 'name'>[]): string {
  const names = new Set(fragments.map((fragment) => fragment.name));
  let n = fragments.length + 1;
  while (names.has(`Fragment ${n}`)) n += 1;
  return `Fragment ${n}`;
}

export function cleanName(name: string, fallback: string): string {
  return name.trim().slice(0, MAX_NAME_LENGTH) || fallback;
}

/**
 * Cut the shapes with the given ids out of the design as a fragment, keeping their
 * colors and stacking order; `null` when none of them exists.
 */
export function extractFragment(
  doc: EditorDoc,
  ids: string[],
  name: string,
  now: Date = new Date(),
): Fragment | null {
  const bounds = shapesBounds(doc, ids);
  if (!bounds) return null;
  const moved = transformShapes(doc, ids, translation(-bounds.x, -bounds.y));
  const wanted = new Set(ids);
  return {
    id: fragmentId(),
    name,
    width: round(bounds.width),
    height: round(bounds.height),
    shapes: moved.groups.flatMap((group) =>
      group.shapes
        .filter((shape) => wanted.has(shape.id))
        .map((shape) => ({ d: shape.d, fill: shapeFill(group, shape) })),
    ),
    createdAt: now.toISOString(),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The fragment as a document: one color group per color, in order of first use. */
export function fragmentDoc(fragment: Fragment): EditorDoc {
  const groups: EditorDoc['groups'] = [];
  fragment.shapes.forEach((shape, index) => {
    let group = groups.find((candidate) => candidate.fill === shape.fill);
    if (!group) {
      group = { paletteIndex: groups.length, fill: shape.fill, shapes: [] };
      groups.push(group);
    }
    group.shapes.push({ id: `f-${index}`, d: shape.d });
  });
  return { width: fragment.width, height: fragment.height, groups };
}

/** Fragment as an SVG image (thumbnails, downloads). */
export function fragmentSvg(fragment: Fragment): string {
  return serializeSvg(fragmentDoc(fragment));
}

export function fragmentColors(fragment: Fragment): string[] {
  return [...new Set(fragment.shapes.map((shape) => shape.fill))];
}

/** Fragments in storage; invalid or missing data reads as an empty library. */
export function readFragments(storage: Pick<Storage, 'getItem'> | undefined): Fragment[] {
  try {
    const raw = storage?.getItem(FRAGMENTS_STORAGE_KEY);
    return raw ? validFragments(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

/** Save the library; `false` when it could not be stored (no storage, quota exceeded). */
export function saveFragments(
  storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined,
  fragments: Fragment[],
): boolean {
  if (!storage) return false;
  try {
    if (fragments.length) storage.setItem(FRAGMENTS_STORAGE_KEY, JSON.stringify(fragments));
    else storage.removeItem(FRAGMENTS_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

const HEX_RE = /^#[0-9a-f]{6}$/;

function isFragment(value: unknown): value is Fragment {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.createdAt === 'string' &&
    Number.isFinite(item.width) &&
    Number.isFinite(item.height) &&
    Array.isArray(item.shapes) &&
    item.shapes.length > 0 &&
    item.shapes.every(
      (shape: unknown) =>
        typeof shape === 'object' &&
        shape !== null &&
        typeof (shape as FragmentShape).d === 'string' &&
        HEX_RE.test(String((shape as FragmentShape).fill)),
    )
  );
}

/** The valid fragments of untrusted data (storage, imported files); others are skipped. */
export function validFragments(value: unknown): Fragment[] {
  return Array.isArray(value) ? value.filter(isFragment) : [];
}

/** The library as a file to back it up or move it to another browser. */
export function libraryFile(fragments: Fragment[]): string {
  return JSON.stringify({ format: LIBRARY_FORMAT, version: 1, fragments }, null, 1);
}

/** Fragments of a library file; throws an error with a message for the user. */
export function parseLibraryFile(text: string): Fragment[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This is not a fragment library (expected a .json file).');
  }
  const library = data as { format?: unknown; fragments?: unknown } | null;
  if (library?.format !== LIBRARY_FORMAT) {
    throw new Error('This is not a VectorSnap fragment library.');
  }
  const fragments = validFragments(library.fragments);
  if (!fragments.length) throw new Error('The library file has no valid fragments.');
  return fragments;
}

/**
 * Add imported fragments to the library (on top, in file order). Fragments already in the
 * library (same id) are skipped, so importing the same file twice adds nothing.
 */
export function mergeFragments(
  current: Fragment[],
  imported: Fragment[],
): { fragments: Fragment[]; added: number } {
  const known = new Set(current.map((fragment) => fragment.id));
  const added = imported.filter((fragment) => {
    if (known.has(fragment.id)) return false;
    known.add(fragment.id);
    return true;
  });
  return { fragments: [...added, ...current], added: added.length };
}

export interface PlaceOptions {
  /** Replace the fragment's colors by the nearest colors of the image (fewer filaments). */
  matchColors: boolean;
}

/**
 * Place a fragment on top of the design, centered; fragments larger than half the image
 * are scaled down. Each color gets a new color group above all others, so the fragment
 * covers what lies below it. Returns the new document and the ids of the placed shapes.
 */
export function placeFragment(
  doc: EditorDoc,
  fragment: Fragment,
  { matchColors }: PlaceOptions,
): { doc: EditorDoc; ids: string[] } {
  const scale = Math.min(
    1,
    (PLACE_MAX_SHARE * doc.width) / fragment.width,
    (PLACE_MAX_SHARE * doc.height) / fragment.height,
  );
  const tx = (doc.width - fragment.width * scale) / 2;
  const ty = (doc.height - fragment.height * scale) / 2;
  const imageColors = [
    ...new Set(doc.groups.flatMap((group) => group.shapes.map((shape) => shapeFill(group, shape)))),
  ];
  const taken = new Set(doc.groups.flatMap((group) => group.shapes.map((shape) => shape.id)));
  let placement = 1;
  while ([...taken].some((id) => id.startsWith(`frag-${placement}-`))) placement += 1;

  let nextIndex = Math.max(-1, ...doc.groups.map((group) => group.paletteIndex)) + 1;
  const added: ColorGroup[] = [];
  const ids: string[] = [];
  fragment.shapes.forEach((shape, index) => {
    const fill = matchColors ? nearestColor(shape.fill, imageColors) : shape.fill;
    let group = added.find((candidate) => candidate.fill === fill);
    if (!group) {
      group = { paletteIndex: nextIndex, fill, shapes: [] };
      nextIndex += 1;
      added.push(group);
    }
    const id = `frag-${placement}-${index}`;
    group.shapes.push({ id, d: transformPath(shape.d, [scale, 0, 0, scale, tx, ty]) });
    ids.push(id);
  });
  return { doc: { ...doc, groups: [...doc.groups, ...added] }, ids };
}
