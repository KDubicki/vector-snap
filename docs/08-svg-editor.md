# 08. SVG Editor

The editor lets the user fix tracing results by **splitting** shapes into smaller pieces
and **recoloring** shapes or whole color groups. It runs entirely in the browser on top of
[Paper.js](http://paperjs.org/), which provides scene-graph hit-testing and robust boolean
operations on paths.

## Document model

1. The SVG returned by `/vectorize` is imported with `project.importSVG(svg, { expandShapes: true })`.
2. Every imported `<path>` becomes a `paper.Path` or `paper.CompoundPath` (shapes with holes).
3. Metadata is kept in `item.data`:

```ts
interface ShapeData {
  id: string;            // "p-3-12", new ids for split parts: "p-3-12.a", "p-3-12.b"
  paletteIndex: number;  // group the shape belongs to
  customFill?: string;   // set when the shape was recolored individually
}
```

4. Palette groups map to `paper.Group` items with `data.paletteIndex`.

## Tools

| Tool | Shortcut | Behavior |
|------|----------|----------|
| Select | `V` | Click selects topmost shape under cursor (`project.hitTest` with `fill: true`). `Shift`+click adds to selection. Click empty area clears selection. |
| Knife (line split) | `K` | Draw a freehand or straight (`Shift`) line across the selected shape → shape is split along the line. |
| Lasso split | `L` | Draw a closed polygon/freehand region → the part of the selected shape inside the region becomes a new shape. |
| Recolor | `C` | Click a shape to apply the current color. |
| Eyedropper | `I` | Pick a color from a shape as the current color. |
| Merge | `M` | Unite selected shapes of the same color into one shape. |
| Delete | `Del` / `Backspace` | Remove selected shapes. |
| Pan | `Space`+drag / `H` | Move viewport. |
| Zoom | wheel / `+` / `-` / `0` (fit) | Zoom around cursor. |
| Undo / Redo | `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` | History navigation. |

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
