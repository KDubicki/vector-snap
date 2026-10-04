# 08. SVG Editor

The editor lets the user fix tracing results by **splitting** shapes into smaller pieces
and **recoloring** shapes or whole color groups. It runs entirely in the browser on top of
[Paper.js](http://paperjs.org/), which provides scene-graph hit-testing and robust boolean
operations on paths.

## Document model

The editor keeps its **own immutable document model** (`src/editor/model.ts`) as the
single source of truth; Paper.js only renders it, hit-tests and runs boolean operations
(`src/editor/scene.ts`). Paper's `importSVG` is deliberately not used: it drops `data-*`
attributes and adds clip groups, which would make export to the SVG contract lossy.

```ts
interface Shape {
  id: string;     // "p-3-12"; split parts get suffixes: "p-3-12.a", "p-3-12.b"
  d: string;      // SVG path data in document coordinates (subpaths = holes)
  fill?: string;  // set only when the shape was recolored individually
}

interface ColorGroup {
  paletteIndex: number;
  fill: string;   // color of the whole group
  shapes: Shape[];
}

interface EditorDoc {
  width: number;
  height: number;
  groups: ColorGroup[]; // bottom to top
}
```

1. After `/vectorize`, `parseSvg()` reads the contract (`<g data-palette-index fill>`,
   `<path id d [fill]>`) with `DOMParser` into an `EditorDoc`.
2. Every edit is a pure function `EditorDoc → EditorDoc`; the store replaces the document.
3. `EditorScene.render(doc)` rebuilds the Paper.js scene (one `CompoundPath` per shape,
   named by its id), so rendering always matches the model.
4. The selection (shape ids) lives in the store; the scene draws it on an overlay layer
   as a dark outline with white dashes, visible on any fill color.

## Tools

Status: ✅ implemented · 🔜 planned.

| Tool | Shortcut | Behavior | Status |
|------|----------|----------|--------|
| Select | `V` | Click selects the topmost shape under the cursor (hit-test on fill; holes are not hits); the shape under the cursor is outlined in blue before clicking. **Drag a box** to select every shape lying completely inside it (the background is never caught). `Shift` adds (click toggles). Click on empty canvas clears. | ✅ |
| Select all | `Ctrl/Cmd+A` | Select every shape. | ✅ |
| Hand / pan | `H`, `Space`+drag, middle button | Drag to move the viewport (works in every tool with `Space` or the middle button). | ✅ |
| Zoom | wheel / `+` / `-` / `0` (fit) / toolbar | Zoom around the cursor, 10 %–6400 % of "fit". | ✅ |
| Clear selection | `Esc` | | ✅ |
| Knife (line split) | `K` / toolbar | Draw a freehand or straight (`Shift`) line; fully crossed shapes are split (see [Knife](#knife-line-cut-)). `Space`+drag pans, `Esc` cancels the line. | ✅ |
| Lasso | `L` / toolbar | Draw a freehand region; the part of the target shape inside it becomes a separate shape and gets selected (see [Lasso](#lasso-region-cut-)). | ✅ |
| Recolor | inspector / color groups panel | Recolor the selection or a whole palette group (see [Recoloring](#recoloring)). | ✅ |
| Eyedropper | `I` | Pick a color from a shape as the current color. | 🔜 |
| Merge | `M` | Unite selected shapes of the same color into one shape. | 🔜 |
| Delete | `Del` / `Backspace` / toolbar | Remove selected shapes; groups left empty disappear. | ✅ |
| Undo / Redo | `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z`, `Ctrl+Y` / toolbar | History navigation (see [Undo / redo](#undo--redo-)). | ✅ |

## Testing

**Canvas sizing:** layout size comes from the `.editor__viewport` wrapper, which a
`ResizeObserver` watches; the canvas only fills it. On HiDPI screens Paper.js writes an
inline pixel size onto the canvas, so observing the canvas itself (with a border) caused
a resize feedback loop that shrank it to nothing. Browser checks therefore also run with
`deviceScaleFactor: 2` and dark mode.

Paper.js runs headless in Vitest's `jsdom` environment; `src/test/canvas-stub.ts`
provides a no-op 2D context (jsdom has no canvas), which is enough for geometry,
hit-testing and scene construction. Model and scene logic are unit-tested; the
interactive component is verified end-to-end in a browser.

## Splitting algorithms

### Knife (line cut) ✅

**Which shapes are cut** (`src/editor/split.ts`): a shape is cut only when the line
**fully crosses** it — both end points lie outside the shape and the cut yields at least
two pieces. The shape the line starts and ends on (typically the background) therefore
stays intact. If the line fully crosses any selected shape, only selected shapes are cut;
otherwise every fully crossed shape is. After a cut the new parts are selected. When
nothing is cut, a neutral hint explains why.

**Geometry** (`src/editor/geometry.ts`, headless Paper.js scope) for shape `S` and the
user polyline `L` (document coordinates, sampled every 4 view px; `Shift` = straight line):

1. Reject if an end point of `L` lies inside `S` or `L` intersects `S` fewer than twice.
2. Extend both ends of `L` along their end directions far beyond `S ∪ L` bounds.
3. Build a **half-plane polygon** `H`: the extended line closed by two far points offset
   along the line's left normal.
4. `A = S.intersect(H)`, `B = S.subtract(H)`.
5. Each of `A`, `B` may contain disjoint pieces — they are separated into independent
   shapes; holes stay with their outer contour (nesting depth is determined from contour
   vertices, which is reliable because result contours never cross).
6. Pieces below 0.5 px² are dropped (numeric slivers).
7. `replaceShape()` puts the parts at the original z-position; ids derive from the
   parent (`p-3-12.a`, `p-3-12.b`, …, existing ids are skipped) and an own color is
   inherited.

### Lasso (region cut) ✅

The lasso (`L`) cuts a freehand region out of shapes — unlike the knife, it does not need
to cross a whole shape, so it is the easier way to isolate a detail or a corner.

**Which shapes are cut** (`cutWithRegion()` in `src/editor/split.ts`): the selected
shapes, or — with nothing selected — the shape under the point where the lasso started.
Other shapes the region overlaps (typically the background) stay intact. A shape is cut
only if the region covers part of it; a region around the whole shape or beside it
changes nothing and shows a hint.

**Geometry** (`cutRegion()` in `src/editor/geometry.ts`):

1. Close the user path into polygon `R` (ignored if its area is below 0.5 px²).
2. `inside = S.intersect(R)`, `outside = S.subtract(R)`, each separated into independent
   pieces with their holes; slivers below 0.5 px² are dropped.
3. `S` is replaced by the inside and outside pieces at its z-position (derived ids as for
   the knife); the **inside pieces become the selection**, ready to recolor or delete.

Because the backend emits shapes in `cutout` mode by default (see
[pipeline](06-image-processing-pipeline.md#5-vectorization-servicesvectorizationpy)),
shapes do not overlap and splitting never reveals hidden geometry underneath.

## Recoloring

Implemented in `src/editor/operations.ts` (pure functions, unit-tested).

- ✅ **Selected shapes** (FR-33) — inspector color picker → `recolorShapes()` sets
  `shape.fill`. The shape stays in its palette group. Picking the group's own color removes
  the override; **Use group color** (`resetShapeColors()`) does the same explicitly.
  Mixed selections show "Mixed colors" and get one common color.
- ✅ **Palette group** (FR-34) — "Color groups" panel → `recolorGroup()` changes
  `group.fill`; shapes without their own color follow, shapes with their own color keep
  it. Overrides that become equal to the new group color are dropped. **Select** selects
  all shapes of a group.
- 🔜 Moving a shape to another palette group and creating new groups for new colors.

## Undo / redo ✅

Snapshot-based (`src/editor/history.ts`) instead of a command pattern: every edit is a
pure function returning a new immutable `EditorDoc` that shares unchanged groups and
shapes with the previous one, so keeping whole documents as snapshots is cheap and every
operation is undoable without writing an inverse.

- All edits go through one `commit()` in the store, which pushes the previous document to
  `history.past` and clears `history.future`. Edits that change nothing are not recorded.
- **Coalescing:** consecutive commits with the same key within 1 s (dragging the color
  picker fires many `input` events) form a single undo step. Keys: `recolor:<ids>`,
  `recolor-group:<index>`.
- Undo/redo keep only selected shapes that still exist.
- History is capped at 100 steps and reset when a new SVG is generated.
- Shortcuts are ignored only while typing in text fields; the canvas takes focus on
  click, so `Ctrl/Cmd+Z` works right after using a color picker.

## Export ✅

`serializeSvg()` (`src/editor/export.ts`) writes the edited `EditorDoc` directly in the
[SVG output contract](05-api-specification.md#svg-output-contract) — the same structure
the backend produces — without going through Paper.js export (which would add clip
groups and drop `data-*` attributes):

- `<svg xmlns viewBox="0 0 W H" width height data-generator="vectorsnap-editor">`
- one `<g id="color-N" data-palette-index="N" fill>` per non-empty group, bottom to top
- `<path id data-palette-index d>` per shape, with `fill` only for shapes that have their
  own color
- attribute values are XML-escaped; `parseSvg(serializeSvg(doc))` round-trips exactly
  (unit-tested), so an exported file can be loaded back into the editor.

The result step always downloads the **edited** document as `<original-name>.svg`
("Download edited SVG" once anything was changed); shape count and file size are
computed from it.

## Performance

- Documents with up to ~5 000 paths must stay interactive (60 fps pan/zoom).
- Hit-testing is restricted to visible items; selection highlight is drawn on a separate
  overlay layer.
- Boolean operations on very complex shapes may take > 100 ms — show a busy cursor and
  run them in `requestIdleCallback`-friendly chunks if needed.

## Keyboard shortcuts

Listed in the tools table above; additionally `Esc` cancels the current tool action and
`Ctrl/Cmd+S` triggers download.
