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
| Select | click | Click selects the topmost shape under the cursor (hit-test on fill; holes are not hits). `Shift`+click toggles a shape in the selection. Click on empty canvas clears it. | ✅ |
| Pan | drag / middle button | Dragging more than 3 px pans instead of selecting. | ✅ |
| Zoom | wheel / `+` / `-` / `0` (fit) / toolbar | Zoom around the cursor, 10 %–6400 % of "fit". | ✅ |
| Clear selection | `Esc` | | ✅ |
| Knife (line split) | `K` | Draw a freehand or straight (`Shift`) line across the selected shape → shape is split along the line. | 🔜 |
| Lasso split | `L` | Draw a closed polygon/freehand region → the part of the selected shape inside the region becomes a new shape. | 🔜 |
| Recolor | `C` | Click a shape to apply the current color. | 🔜 |
| Eyedropper | `I` | Pick a color from a shape as the current color. | 🔜 |
| Merge | `M` | Unite selected shapes of the same color into one shape. | 🔜 |
| Delete | `Del` / `Backspace` | Remove selected shapes. | 🔜 |
| Undo / Redo | `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` | History navigation. | 🔜 |

## Testing

Paper.js runs headless in Vitest's `jsdom` environment; `src/test/canvas-stub.ts`
provides a no-op 2D context (jsdom has no canvas), which is enough for geometry,
hit-testing and scene construction. Model and scene logic are unit-tested; the
interactive component is verified end-to-end in a browser.

## Splitting algorithms

### Knife (line cut)

Input: selected shape `S`, user polyline `L` (points in project coordinates).

1. Simplify `L` (`path.simplify(tolerance)`) and require that it intersects `S` at
   least twice (`S.getIntersections(L).length >= 2`); otherwise show a hint and abort.
2. Extend both ends of `L` beyond `S.bounds` along their end tangents.
3. Build a **half-plane polygon** `H`: the extended line closed around one side of
   `S.bounds` (expanded by a margin).
4. `A = S.intersect(H)`, `B = S.subtract(H)`.
5. Each of `A`, `B` may be a `CompoundPath` with disjoint pieces — split them into
   independent shapes (`compound.children` grouped by containment so holes stay with
   their outer contour).
6. Drop parts with area below a threshold (e.g. 0.5 px²) — numeric slivers.
7. Replace `S` by the new shapes in the same group and z-order; ids derived from the
   parent id (`p-3-12.a`, `p-3-12.b`, …); `paletteIndex` and `customFill` inherited.

### Lasso (region cut)

1. Close the user path into polygon `R`.
2. `inside = S.intersect(R)`, `outside = S.subtract(R)`.
3. Same cleanup as steps 5–7 above.

Because the backend emits shapes in `cutout` mode by default (see
[pipeline](06-image-processing-pipeline.md#5-vectorization-servicesvectorizationpy)),
shapes do not overlap and splitting never reveals hidden geometry underneath.

## Recoloring

- **Single shape:** sets `item.fillColor` and `data.customFill`. The shape stays in its
  palette group (so group recolor does not override it unless "Apply to overridden shapes"
  is checked).
- **Palette group:** changes the group's `fillColor`; children without `customFill` follow.
- **Move to palette color:** assigning a shape to an existing palette color moves it into
  that group (keeps the document structure clean for export).
- A new color not present in the palette creates a new palette group.

## Undo / redo

Command pattern; each command implements `do()` / `undo()` and stores only what it needs:

| Command | Stored data |
|---------|-------------|
| `SplitShape` | removed shape (exported JSON via `item.exportJSON()`), ids of created shapes, insertion index |
| `RecolorShape` | shape id, previous/next fill |
| `RecolorGroup` | palette index, previous/next color |
| `MergeShapes` | removed shapes JSON, created shape id |
| `DeleteShapes` | removed shapes JSON + indices |

History is capped (default 100 steps). History is reset when the user re-vectorizes.

## Export

1. `project.exportSVG({ asString: true, bounds: 'content', precision: 2 })`.
2. Normalize to the [SVG output contract](05-api-specification.md#svg-output-contract):
   restore `viewBox` from the original document, one `<g>` per palette color, `id` and
   `data-palette-index` on every path, per-path `fill` only for `customFill` shapes,
   remove Paper.js-specific attributes.
3. Offer download as `<original-name>.svg` via a `Blob` URL.

## Performance

- Documents with up to ~5 000 paths must stay interactive (60 fps pan/zoom).
- Hit-testing is restricted to visible items; selection highlight is drawn on a separate
  overlay layer.
- Boolean operations on very complex shapes may take > 100 ms — show a busy cursor and
  run them in `requestIdleCallback`-friendly chunks if needed.

## Keyboard shortcuts

Listed in the tools table above; additionally `Esc` cancels the current tool action and
`Ctrl/Cmd+S` triggers download.
