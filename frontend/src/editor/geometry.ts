/**
 * Geometry on top of a headless Paper.js scope: boolean operations for splitting shapes.
 * See docs/08-svg-editor.md#splitting-algorithms.
 */
import paper from 'paper';

export interface Point {
  x: number;
  y: number;
}

/** Pieces smaller than this (in document px²) are numerical slivers and are dropped. */
const MIN_PIECE_AREA = 0.5;
const PATH_PRECISION = 2;

let scope: paper.PaperScope | null = null;

/** Lazily created scope used only for computations (never rendered). */
function geometryScope(): paper.PaperScope {
  if (!scope) {
    scope = new paper.PaperScope();
    scope.setup(new scope.Size(1, 1));
  }
  scope.activate();
  return scope;
}

function toPathItem(s: paper.PaperScope, d: string): paper.CompoundPath {
  return new s.CompoundPath({ pathData: d, insert: false });
}

/** Split compound results into independent pieces; holes stay with their outer contour. */
function separatePieces(s: paper.PaperScope, item: paper.PathItem): paper.CompoundPath[] {
  const contours = (item instanceof s.CompoundPath ? item.children : [item]) as paper.Path[];
  // Contours of a boolean result never cross, so any vertex tells whether a contour lies
  // inside another one. (`interiorPoint` would not work: for an outer contour it can fall
  // inside its own hole.)
  const inside = (contour: paper.Path, other: paper.Path) =>
    other !== contour && other.contains(contour.firstSegment.point);
  const depth = (contour: paper.Path) => contours.filter((other) => inside(contour, other)).length;

  const outers = contours.filter((contour) => depth(contour) % 2 === 0);
  return outers.map((outer) => {
    const holes = contours.filter(
      (contour) => depth(contour) === depth(outer) + 1 && inside(contour, outer),
    );
    return new s.CompoundPath({
      children: [outer, ...holes].map((contour) => contour.clone({ insert: false })),
      insert: false,
    });
  });
}

/**
 * Split a shape along a polyline. Returns the path data of the resulting pieces, or `null`
 * when the line does not fully cross the shape (both ends must lie outside of it and the
 * cut must produce at least two pieces).
 */
export function splitShape(d: string, line: Point[]): string[] | null {
  if (line.length < 2) return null;
  const s = geometryScope();
  const shape = toPathItem(s, d);
  const points = line.map((p) => new s.Point(p.x, p.y));
  const first = points[0];
  const last = points[points.length - 1];

  if (shape.contains(first) || shape.contains(last)) return null;
  const knife = new s.Path({ segments: points, insert: false });
  if (shape.getIntersections(knife).length < 2) return null;

  // Extend both ends far beyond the shape, then close the line into a polygon covering
  // everything on its left side.
  const extent = shape.bounds.unite(knife.bounds);
  const reach = (extent.width + extent.height) * 4 + 1;
  const startDir = first.subtract(points[1]).normalize();
  const endDir = last.subtract(points[points.length - 2]).normalize();
  const along = last.subtract(first);
  const normal = (along.length > 0 ? along : endDir).normalize().rotate(-90, new s.Point(0, 0));
  const start = first.add(startDir.multiply(reach));
  const end = last.add(endDir.multiply(reach));
  const halfPlane = new s.Path({
    segments: [
      start,
      ...points,
      end,
      end.add(normal.multiply(reach)),
      start.add(normal.multiply(reach)),
    ],
    closed: true,
    insert: false,
  });

  const pieces = [
    shape.intersect(halfPlane, { insert: false }),
    shape.subtract(halfPlane, { insert: false }),
  ]
    .flatMap((part) => separatePieces(s, part))
    .filter((piece) => Math.abs(piece.area) >= MIN_PIECE_AREA);

  if (pieces.length < 2) return null;
  return pieces.map(pathData);
}

export interface RegionCut {
  /** Pieces inside the region. */
  inside: string[];
  /** Pieces outside the region. */
  outside: string[];
}

/**
 * Cut a shape with a closed region (lasso). Returns the pieces inside and outside of it,
 * or `null` when the region does not split the shape (no overlap, or it covers it fully).
 */
export function cutRegion(d: string, region: Point[]): RegionCut | null {
  if (region.length < 3) return null;
  const s = geometryScope();
  const shape = toPathItem(s, d);
  const lasso = new s.Path({
    segments: region.map((p) => new s.Point(p.x, p.y)),
    closed: true,
    insert: false,
  });
  if (Math.abs(lasso.area) < MIN_PIECE_AREA) return null;

  const pieces = (item: paper.PathItem) =>
    separatePieces(s, item)
      .filter((piece) => Math.abs(piece.area) >= MIN_PIECE_AREA)
      .map(pathData);
  const inside = pieces(shape.intersect(lasso, { insert: false }));
  const outside = pieces(shape.subtract(lasso, { insert: false }));
  return inside.length && outside.length ? { inside, outside } : null;
}

function pathData(item: paper.PathItem): string {
  const svg = item.exportSVG({ asString: true, precision: PATH_PRECISION }) as string;
  return /\sd="([^"]+)"/.exec(svg)?.[1] ?? '';
}

/** Area of a path (absolute, holes subtracted). */
export function pathArea(d: string): number {
  return Math.abs(toPathItem(geometryScope(), d).area);
}
