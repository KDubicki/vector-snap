import { findShape, shapeFill } from '../editor/model';
import { shapesBounds, type SelectionTransform } from '../editor/transform';
import { useAppStore } from '../state/store';

const TRANSFORMS: { kind: SelectionTransform; label: string; title: string }[] = [
  { kind: 'smaller', label: 'Smaller', title: 'Shrink the selection by 10%' },
  { kind: 'larger', label: 'Larger', title: 'Enlarge the selection by 10%' },
  { kind: 'flip-x', label: 'Flip ↔', title: 'Mirror the selection horizontally' },
  { kind: 'flip-y', label: 'Flip ↕', title: 'Mirror the selection vertically' },
  { kind: 'rotate', label: 'Rotate 90°', title: 'Rotate the selection 90° clockwise' },
];

/** Details, color and placement of the current selection (FR-33). */
export function ShapeInspector() {
  const editor = useAppStore((s) => s.editor);
  const selection = useAppStore((s) => s.selection);
  const { recolorSelection, resetSelectionColor, moveSelectionToGroup, transformSelection } =
    useAppStore.getState();

  if (!editor) return null;
  if (selection.length === 0) {
    return <p className="hint">Select a shape on the canvas to inspect or recolor it.</p>;
  }

  const shapes = selection.map((id) => findShape(editor, id)).filter((found) => found !== null);
  const colors = new Set(shapes.map(({ group, shape }) => shapeFill(group, shape)));
  const current = colors.size === 1 ? [...colors][0] : '#000000';
  const hasOwnColor = shapes.some(({ shape }) => shape.fill !== undefined);
  const groupsOfSelection = new Set(shapes.map(({ group }) => group.paletteIndex));
  const currentGroup = groupsOfSelection.size === 1 ? [...groupsOfSelection][0] : null;
  const bounds = shapesBounds(editor, selection);

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
      <div className="move-to-group">
        <span className="hint">Move to color group</span>
        <div className="move-to-group__swatches">
          {editor.groups.map((group) => (
            <button
              key={group.paletteIndex}
              type="button"
              className="swatch-button"
              style={{ background: group.fill }}
              aria-pressed={currentGroup === group.paletteIndex && !hasOwnColor}
              aria-label={`Move to group ${group.paletteIndex + 1} (${group.fill})`}
              title={group.fill}
              onClick={() => moveSelectionToGroup(group.paletteIndex)}
            />
          ))}
        </div>
      </div>
      <div className="transform">
        <span className="hint">
          Size{' '}
          {bounds && (
            <output aria-label="Selection size">
              {Math.round(bounds.width)} × {Math.round(bounds.height)} px
            </output>
          )}
        </span>
        <div className="transform__buttons" role="group" aria-label="Transform selection">
          {TRANSFORMS.map(({ kind, label, title }) => (
            <button
              key={kind}
              type="button"
              className="secondary"
              title={title}
              onClick={() => transformSelection(kind)}
            >
              {label}
            </button>
          ))}
        </div>
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
