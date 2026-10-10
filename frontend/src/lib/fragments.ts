/**
 * Fragments: parts of a design (selected shapes with their colors) saved in a library,
 * to be placed later on another image. Stored per browser; the page works without
 * storage (private mode, blocked data), fragments then last until the page is closed.
 * See docs/08-svg-editor.md#fragments.
 */
import { serializeSvg } from '../editor/export';
import { shapeFill, type EditorDoc } from '../editor/model';
import { shapesBounds, transformShapes, translation } from '../editor/transform';

export const FRAGMENTS_STORAGE_KEY = 'vectorsnap.fragments';
export const MAX_NAME_LENGTH = 60;

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
