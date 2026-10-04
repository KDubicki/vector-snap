/**
 * Editor document model — the single source of truth for the SVG editor.
 *
 * Paper.js is only used to render, hit-test and run boolean operations; every edit
 * produces a new immutable `EditorDoc`, which makes undo/redo and export trivial.
 * Mirrors the SVG output contract in docs/05-api-specification.md.
 */

export interface Shape {
  /** Stable id, e.g. "p-3-12"; split parts get suffixes ("p-3-12.a"). */
  id: string;
  /** SVG path data in document coordinates. */
  d: string;
  /** Color set on this shape only; `undefined` means it follows its group. */
  fill?: string;
}

export interface ColorGroup {
  paletteIndex: number;
  fill: string;
  shapes: Shape[];
}

export interface EditorDoc {
  width: number;
  height: number;
  /** Bottom to top. */
  groups: ColorGroup[];
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Parse an SVG produced by the backend (`/vectorize`) into an editor document. */
export function parseSvg(svg: string): EditorDoc {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = document.documentElement;
  if (root.localName !== 'svg' || root.namespaceURI !== SVG_NS) {
    throw new Error('Not an SVG document');
  }

  const [, , vbWidth, vbHeight] = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const width = vbWidth || Number(root.getAttribute('width')) || 0;
  const height = vbHeight || Number(root.getAttribute('height')) || 0;

  const groups: ColorGroup[] = Array.from(root.children)
    .filter((element) => element.localName === 'g')
    .map((group) => {
      const paletteIndex = Number(group.getAttribute('data-palette-index') ?? 0);
      return {
        paletteIndex,
        fill: (group.getAttribute('fill') ?? '#000000').toLowerCase(),
        shapes: Array.from(group.children)
          .filter((element) => element.localName === 'path' && element.getAttribute('d'))
          .map((path, sequence) => {
            const fill = path.getAttribute('fill')?.toLowerCase();
            return {
              id: path.getAttribute('id') ?? `p-${paletteIndex}-${sequence}`,
              d: path.getAttribute('d') ?? '',
              ...(fill ? { fill } : {}),
            };
          }),
      };
    });

  return { width, height, groups };
}

/** Effective color of a shape. */
export function shapeFill(group: ColorGroup, shape: Shape): string {
  return shape.fill ?? group.fill;
}

/** Locate a shape by id. */
export function findShape(doc: EditorDoc, id: string): { group: ColorGroup; shape: Shape } | null {
  for (const group of doc.groups) {
    const shape = group.shapes.find((candidate) => candidate.id === id);
    if (shape) return { group, shape };
  }
  return null;
}

export function shapeCount(doc: EditorDoc): number {
  return doc.groups.reduce((total, group) => total + group.shapes.length, 0);
}
