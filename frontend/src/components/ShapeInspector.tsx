import { findShape, shapeFill } from '../editor/model';
import { useAppStore } from '../state/store';

/** Details of the current selection. */
export function ShapeInspector() {
  const editor = useAppStore((s) => s.editor);
  const selection = useAppStore((s) => s.selection);

  if (!editor) return null;
  if (selection.length === 0) {
    return <p className="hint">Select a shape on the canvas to inspect it.</p>;
  }

  const shapes = selection.map((id) => findShape(editor, id)).filter((found) => found !== null);

  return (
    <div className="field">
      <span>
        {selection.length === 1 ? 'Selected shape' : `${selection.length} shapes selected`}
      </span>
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
