import { findShape, shapeFill } from '../editor/model';
import { useAppStore } from '../state/store';

/** Details and color of the current selection (FR-33). */
export function ShapeInspector() {
  const editor = useAppStore((s) => s.editor);
  const selection = useAppStore((s) => s.selection);
  const { recolorSelection, resetSelectionColor } = useAppStore.getState();

  if (!editor) return null;
  if (selection.length === 0) {
    return <p className="hint">Select a shape on the canvas to inspect or recolor it.</p>;
  }

  const shapes = selection.map((id) => findShape(editor, id)).filter((found) => found !== null);
  const colors = new Set(shapes.map(({ group, shape }) => shapeFill(group, shape)));
  const current = colors.size === 1 ? [...colors][0] : '#000000';
  const hasOwnColor = shapes.some(({ shape }) => shape.fill !== undefined);

  return (
    <div className="field">
      <span>
        {selection.length === 1 ? 'Selected shape' : `${selection.length} shapes selected`}
      </span>
      <div className="selection-color">
        <input
          type="color"
          value={current}
          aria-label="Selection color"
          onChange={(event) => recolorSelection(event.target.value)}
        />
        <span>{colors.size === 1 ? current : 'Mixed colors'}</span>
        <button
          type="button"
          className="link"
          onClick={resetSelectionColor}
          disabled={!hasOwnColor}
        >
          Use group color
        </button>
      </div>
      <ul className="inspector">
        {shapes.map(({ group, shape }) => (
          <li key={shape.id}>
            <span className="swatch" style={{ background: shapeFill(group, shape) }} />
            <code>{shape.id}</code>
            <code>{shapeFill(group, shape)}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}
