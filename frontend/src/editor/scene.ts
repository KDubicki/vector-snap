import paper from 'paper';
import { shapeFill, type EditorDoc } from './model';

export interface ViewPoint {
  x: number;
  y: number;
}

const MIN_ZOOM_FACTOR = 0.1; // relative to the "fit" zoom
const MAX_ZOOM_FACTOR = 64;
const HOVER_COLOR = '#2f80ff';
// Dark outline + white dashes stay visible on any fill color.
const OUTLINE_STYLES = [
  { color: '#111111', width: 3, dash: [] as number[] },
  { color: '#ffffff', width: 1.5, dash: [4, 3] },
];

/**
 * Paper.js scene for the editor: renders an `EditorDoc`, highlights the selection,
 * hit-tests shapes and manages the viewport. Holds no document state of its own.
 */
export class EditorScene {
  readonly scope: paper.PaperScope;
  private readonly content: paper.Layer;
  private readonly hoverLayer: paper.Layer;
  private readonly overlay: paper.Layer;
  private readonly guide: paper.Layer;
  private hovered: string | null = null;
  private fitZoom = 1;

  constructor(target: HTMLCanvasElement | { width: number; height: number }) {
    this.scope = new paper.PaperScope();
    this.scope.setup(
      target instanceof HTMLCanvasElement
        ? target
        : new this.scope.Size(target.width, target.height),
    );
    this.content = new this.scope.Layer();
    this.hoverLayer = new this.scope.Layer();
    this.overlay = new this.scope.Layer();
    this.guide = new this.scope.Layer();
  }

  /** Rebuild the scene from the document (bottom group first). */
  render(doc: EditorDoc): void {
    this.content.removeChildren();
    this.hover(null);
    this.content.addChild(
      new this.scope.Path.Rectangle({
        rectangle: new this.scope.Rectangle(0, 0, doc.width, doc.height),
        strokeColor: new this.scope.Color(0.5, 0.5, 0.5, 0.4),
        strokeWidth: 1,
        strokeScaling: false,
        name: 'artboard',
      }),
    );
    for (const group of doc.groups) {
      const layer = new this.scope.Group({ name: `color-${group.paletteIndex}` });
      for (const shape of group.shapes) {
        const item = new this.scope.CompoundPath(shape.d);
        item.fillColor = new this.scope.Color(shapeFill(group, shape));
        item.name = shape.id;
        item.data = { shapeId: shape.id };
        layer.addChild(item);
      }
      this.content.addChild(layer);
    }
  }

  /** Outline the given shapes on the overlay layer. */
  highlight(ids: string[]): void {
    this.overlay.removeChildren();
    for (const id of ids) {
      const item = this.findItem(id);
      if (!item) continue;
      for (const style of OUTLINE_STYLES) {
        const outline = item.clone({ insert: false });
        outline.fillColor = null;
        outline.strokeColor = new this.scope.Color(style.color);
        outline.strokeWidth = style.width;
        outline.dashArray = style.dash;
        outline.strokeScaling = false;
        this.overlay.addChild(outline);
      }
    }
  }

  /** Move shapes (and the selection outlines) on screen only, while they are dragged. */
  previewMove(ids: string[], dx: number, dy: number): void {
    const delta = new this.scope.Point(dx, dy);
    for (const id of ids) this.findItem(id)?.translate(delta);
    this.overlay.translate(delta);
  }

  /** Thin outline of the shape under the cursor (preview of what a click selects). */
  hover(id: string | null): void {
    if (id === this.hovered) return;
    this.hovered = id;
    this.hoverLayer.removeChildren();
    const item = id ? this.findItem(id) : null;
    if (!item) return;
    const outline = item.clone({ insert: false });
    outline.fillColor = null;
    outline.strokeColor = new this.scope.Color(HOVER_COLOR);
    outline.strokeWidth = 1.5;
    outline.strokeScaling = false;
    this.hoverLayer.addChild(outline);
  }

  /** Draw (or clear with `null`) a selection rectangle given by two document points. */
  drawMarquee(from: ViewPoint | null, to?: ViewPoint): void {
    this.guide.removeChildren();
    if (!from || !to) return;
    for (const style of OUTLINE_STYLES) {
      this.guide.addChild(
        new this.scope.Path.Rectangle({
          from: this.point(from),
          to: this.point(to),
          strokeColor: new this.scope.Color(style.color),
          strokeWidth: style.width,
          dashArray: style.dash,
          strokeScaling: false,
          fillColor: new this.scope.Color(0.5, 0.5, 0.5, 0.08),
        }),
      );
    }
  }

  /** Ids of shapes lying completely inside the rectangle spanned by two document points. */
  shapesInside(from: ViewPoint, to: ViewPoint): string[] {
    const rect = new this.scope.Rectangle(this.point(from), this.point(to));
    return this.content
      .getItems({ match: (item: paper.Item) => Boolean(item.data?.shapeId) })
      .filter((item) => rect.contains(item.bounds))
      .map((item) => item.data.shapeId as string);
  }

  /** Draw (or clear with `null`) the knife line preview, in document coordinates. */
  drawGuide(points: { x: number; y: number }[] | null): void {
    this.guide.removeChildren();
    if (!points || points.length < 2) return;
    for (const style of OUTLINE_STYLES) {
      this.guide.addChild(
        new this.scope.Path({
          segments: points.map((p) => new this.scope.Point(p.x, p.y)),
          strokeColor: new this.scope.Color(style.color),
          strokeWidth: style.width,
          dashArray: style.dash,
          strokeScaling: false,
        }),
      );
    }
  }

  /** Id of the topmost shape under a point in view (canvas pixel) coordinates. */
  hitTest(point: ViewPoint): string | null {
    const hit = this.content.hitTest(this.scope.view.viewToProject(this.point(point)), {
      fill: true,
      stroke: false,
      tolerance: 0,
    });
    let item: paper.Item | null = hit?.item ?? null;
    while (item && !item.data?.shapeId) item = item.parent;
    return (item?.data?.shapeId as string | undefined) ?? null;
  }

  /** Center the document and zoom so it fits the viewport with a small margin. */
  fit(doc: EditorDoc): void {
    const view = this.scope.view;
    const { width, height } = view.viewSize;
    if (!doc.width || !doc.height || !width || !height) return;
    this.fitZoom = Math.min(width / doc.width, height / doc.height) * 0.95;
    view.zoom = this.fitZoom;
    view.center = new this.scope.Point(doc.width / 2, doc.height / 2);
  }

  /** Zoom by `factor`, keeping the document point under `around` fixed on screen. */
  zoomAt(factor: number, around: ViewPoint): void {
    const view = this.scope.view;
    const anchor = view.viewToProject(this.point(around));
    const target = Math.min(
      Math.max(view.zoom * factor, this.fitZoom * MIN_ZOOM_FACTOR),
      this.fitZoom * MAX_ZOOM_FACTOR,
    );
    view.scale(target / view.zoom, anchor);
  }

  /** Move the content by a delta in view pixels. */
  panBy(dx: number, dy: number): void {
    const view = this.scope.view;
    view.center = view.center.subtract(new this.scope.Point(dx, dy).divide(view.zoom));
  }

  /** Current zoom relative to "fit" (1 = fit). */
  get relativeZoom(): number {
    return this.scope.view.zoom / this.fitZoom;
  }

  resize(width: number, height: number): void {
    this.scope.view.viewSize = new this.scope.Size(width, height);
  }

  /** Project (document) coordinates for a view point. */
  toDocument(point: ViewPoint): ViewPoint {
    const projected = this.scope.view.viewToProject(this.point(point));
    return { x: projected.x, y: projected.y };
  }

  destroy(): void {
    this.scope.project.remove();
  }

  private findItem(id: string): paper.Item | null {
    return this.content.getItem({ name: id }) ?? null;
  }

  private point({ x, y }: ViewPoint): paper.Point {
    return new this.scope.Point(x, y);
  }
}
