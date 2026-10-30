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
| Move | drag a selected shape / arrow keys | Dragging a selected shape (Select tool) moves the whole selection; arrows nudge it by 1 px, `Shift`+arrow by 10 px (see [Transforming shapes](#transforming-shapes-)). | ✅ |
| Select all | `Ctrl/Cmd+A` | Select every shape. | ✅ |
| Hand / pan | `H`, `Space`+drag, middle button | Drag to move the viewport (works in every tool with `Space` or the middle button). | ✅ |
| Zoom | wheel / `+` / `-` / `0` (fit) / toolbar | Zoom around the cursor, 10 %–6400 % of "fit". | ✅ |
| Clear selection | `Esc` | | ✅ |
| Knife (line split) | `K` / toolbar | Draw a freehand or straight (`Shift`) line; fully crossed shapes are split (see [Knife](#knife-line-cut-)). `Space`+drag pans, `Esc` cancels the line. | ✅ |
| Lasso | `L` / toolbar | Draw a freehand region; the part of the target shape inside it becomes a separate shape and gets selected (see [Lasso](#lasso-region-cut-)). | ✅ |
| Scale / flip / rotate | inspector | Smaller, Larger (10 % steps), mirror horizontally or vertically, rotate 90° around the selection center. | ✅ |
| Recolor | inspector / color groups panel | Recolor the selection or a whole palette group (see [Recoloring](#recoloring)). | ✅ |
| Eyedropper | `I` / toolbar | Select shapes, then click the shape whose color they take (see [Recoloring](#recoloring)). Drags do not draw a box; the color is picked where the click ends. | ✅ |
| Merge | `M` / toolbar | Unite the selected shapes into one (see [Merging and moving](#merging-and-moving-shapes-)). | ✅ |
| Delete | `Del` / `Backspace` / toolbar | Remove selected shapes; groups left empty disappear. On the server: `POST /api/v1/svg/delete`, by id or below an area. | ✅ |
| Undo / Redo | `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z`, `Ctrl+Y` / toolbar | History navigation (see [Undo / redo](#undo--redo-)). | ✅ |
| Background | toolbar | Checkerboard (shows transparency), light or dark canvas background, so white or dark shapes stand out; remembered in this browser (`src/lib/backdrop.ts`). | ✅ |

The toolbar has four button groups — tools, edit (undo, redo, delete, merge), zoom and
background —
that wrap as a whole on narrow screens (dividers only on wide layouts), so related
buttons stay together. On phones (≤ 600 px) the canvas is `min(60vh, 90vw)` tall
instead of `min(70vh, 720px)`, leaving less empty space around the drawing.

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

The same cut runs on the server for scripts and services: `POST /api/v1/svg/split`
(`app/services/svg_split.py`, Shapely instead of Paper.js; curves of a split shape become
straight segments), see [05](05-api-specification.md#post-apiv1svgsplit).

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

## Merging and moving shapes ✅

- **Merge** (`mergeSelection()`, FR-35) — the selected shapes (≥ 2, any colors) are united
  with Paper.js `unite` (`uniteShapes()` in `geometry.ts`): adjacent pieces fuse into one
  contour, disjoint ones become subpaths of a single shape. The result keeps the **id,
  group, own color and z-position of the largest** selected shape — merging slivers into
  a main shape keeps the main shape's identity. Typical use: undo over-splitting or
  clean up fragments after cutting.
- **Move to color group** (`moveSelectionToGroup()`) — inspector swatches move the
  selection on top of another group and drop own colors, so the shapes take that group's
  color (and later group recolors apply to them). Groups left empty disappear.

## Transforming shapes ✅

Placing fragments and adjusting parts needs shapes to move. Transforms are affine
matrices applied to the path data (`transformPath()` in `geometry.ts`,
`transformShapes()` in `transform.ts`), so the document stays plain SVG paths and
every transform is one undoable edit.

- **Move** (`moveSelection(dx, dy)`) — in the Select tool, pressing on a shape that is
  already selected drags the selection instead of drawing a box (the cursor turns into a
  move cursor over it). While dragging, only the Paper.js items are translated
  (`EditorScene.previewMove`); the document changes once, on release. A press without a
  drag selects the clicked shape as before; `Esc` or a cancelled pointer restores the
  original position. Arrow keys nudge by 1 document px (`Shift`: 10 px); consecutive
  nudges coalesce into one undo step.
- **Scale, flip, rotate** (`transformSelection(kind)`) — inspector buttons *Smaller* /
  *Larger* (÷/× 1.1), *Flip ↔*, *Flip ↕* and *Rotate 90°* (clockwise) transform the
  selection around the center of its bounding box (`transformMatrix()`); the inspector
  shows the selection size in document px.
- Moving does not cut or fill the shapes underneath: a moved shape leaves the area it
  covered showing whatever lies below (often a hole in the background shape).

## Fragments ✅

A **fragment** is a part of a design saved to be placed on other images later — a logo,
a frame, a star. `src/lib/fragments.ts`, `src/state/fragmentsSlice.ts`, panel
`FragmentsPanel`.

- **Save** (`saveFragment(name?)`) — the selected shapes are copied with their effective
  colors (own color or group color) and stacking order, and moved so the fragment's
  bounding box starts at (0, 0) (`extractFragment()`). Size is kept in document px. An
  empty name becomes "Fragment N".
- **Library** — newest first; each entry shows a thumbnail (the fragment serialized with
  `serializeSvg()`, one group per color, as an `<img>` data URL), shape and color counts.
  Names are edited in place (Enter or leaving the field saves; an empty name keeps the
  old one), Delete asks for confirmation.
- **Storage** — `localStorage` key `vectorsnap.fragments` (JSON array). Reading skips
  invalid entries (`validFragments()`), so damaged data never breaks the page. When the
  library cannot be stored (private mode, blocked site data, quota exceeded), it still
  works for the open page and the panel says that it will be lost on closing.
- The library belongs to the browser, not to the image: starting with a new image keeps
  it.
- **Place** (`placeFragment(fragment, { matchColors })`) — puts a fragment on top of the
  current design, centered; a fragment larger than half the image (either side) is
  scaled down to fit. Every color of the fragment gets a **new color group above all
  others** (new palette indices), so the fragment covers what lies below — in the
  editor, in exported SVGs and in 3D models, where covered areas are cut out of the
  parts below ([13-export-formats.md](13-export-formats.md)). The placed shapes
  (`frag-N-i` ids) become the selection, ready to drag, nudge, scale, flip or rotate;
  placing is one undo step. With *Place in this image's nearest colors* each color is
  replaced by the nearest color already used in the image (redmean RGB distance,
  `nearestColor()` in `lib/color.ts`), so no extra filament is needed.
- **Export / import** — *Export library* downloads `vectorsnap-fragments.json`
  (`{"format": "vectorsnap-fragments", "version": 1, "fragments": [...]}`) to back the
  library up or move it to another browser. *Import library…* adds the valid fragments of
  such a file on top (`parseLibraryFile()`, `mergeFragments()`); fragments already in
  the library (same id) are skipped, so importing a file twice adds nothing. Other files
  are rejected with a message.

```ts
interface Fragment {
  id: string;
  name: string;
  width: number;  height: number;          // document px
  shapes: { d: string; fill: string }[];  // bottom to top, top-left at (0, 0)
  createdAt: string;                      // ISO time
}
```

## Selecting small shapes ✅

Tracing leaves specks and slivers that are tedious to click one by one. "Select shapes
smaller than … px²" (`SmallShapesSelector`, default 25 = a 5 × 5 px speck) selects every
shape whose area — in document px, holes subtracted, `shapesSmallerThan()` in
`src/editor/geometry.ts` — is below the limit. The usual actions then apply to all of
them at once: delete, recolor, merge or move to another color group, each undoable. If
nothing is that small, the editor shows a notice instead of clearing the selection
silently.

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
- ✅ Moving shapes to another palette group (see [Merging and moving](#merging-and-moving-shapes-)).
- ✅ **Eyedropper** (`I`) — `matchColor()`, store action `matchSelectionColor(id)`: the
  selection takes the clicked shape's color. A shape with its own color passes that color
  on; a shape that follows its group passes the group itself, so the selection *moves into
  that group* (like **Move to color group**) instead of copying the color — no second
  group of the same color appears, and later recolors of the group reach them too.
  Without a selection, or when nothing would change, a notice says so.
- ✅ **New color group** — the **+** after the *Move to color group* swatches
  (`moveShapesToNewGroup()`, store action `moveSelectionToNewGroup()`): the selection
  becomes a color group of its own in its color, so a recolored part gets its own
  filament and height in a 3D print instead of staying an own color inside its old
  group. The group takes the next free palette index and sits just above the highest
  group the shapes came from, so they stay above what they covered; groups left empty
  disappear. Disabled for mixed colors (recolor them first); a notice says when the
  shapes already are a group of their own.

## Similar colors ✅

Recoloring, placed fragments and opened SVGs can leave colors nobody can tell apart —
#ffffff and #fefefe — and every color group becomes its own filament in a 3D print.
`src/editor/similarColors.ts`, under the "Color groups" panel.

- **Scale** — CIEDE2000 (ΔE00, `deltaE2000()` in `lib/color.ts`), the same as the palette
  step's *Merge similar colors* (`merge_delta_e`, [06](06-image-processing-pipeline.md)):
  *Invisible* < 1, *Close* < 2 (default), *Similar* < 5.
- **Finding** (`findSimilarColors(doc, maxDeltaE)`) — the closest pair of group colors
  below the limit merges first, the group covering more (summed `pathArea()`) stays,
  ties keep the lower group; repeated until no pair is that close, so chains end in the
  group that stays. Shapes whose own color is that close to their group's (new) color are
  listed too. The panel shows every merge (`#fefefe → #ffffff ΔE 0.2`) before it happens.
- **Merging** (`mergeSimilarColors()`, store action `mergeSimilarColors(level)`) — the
  shapes of a merged group move on top of the group they join (as with *Move to color
  group*) keeping own colors that differ; the listed own colors are dropped. One undo step.

## My filaments ✅

**My filaments** under *Similar colors* lists, for every color group, the closest of the
filaments chosen in the colors step (*My filaments*, `filamentLibrary.owned`), by
CIEDE2000: *#fe014d → Magenta ΔE 14.8*. **Use my filaments** (`snapToFilaments` in
`src/editor/filamentSnap.ts`, one undo step) recolors every group and every own shape
color to its filament; groups that become the same filament join like similar colors
(the one covering more stays), and own colors that become their group's filament
follow the group. The SVG then prints exactly with the loaded filaments. Without
chosen filaments the section says where to choose them; when every color is a
filament's already it says so.

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
`Ctrl/Cmd+S` downloads the edited SVG (named after the image, like **Download SVG**, and
marked as saved, instead of the browser saving the page). **`?`** — or the **?** button
at the end of the toolbar — opens *Keyboard shortcuts* (`ShortcutsDialog`), every
shortcut grouped by tools, selection, view, and file and history, with the keys as this
keyboard prints them (⌘ and ⇧ on a Mac, Ctrl elsewhere). The list is data,
`src/editor/shortcuts.ts`; the keys are handled in `SvgEditor`.
