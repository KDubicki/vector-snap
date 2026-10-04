import { useAppStore } from '../state/store';

/** Colors of the document's palette groups; changing one recolors the group (FR-34). */
export function EditorPalettePanel() {
  const editor = useAppStore((s) => s.editor);
  const recolorGroup = useAppStore((s) => s.recolorGroup);
  const select = useAppStore((s) => s.select);

  if (!editor) return null;

  return (
    <div className="field">
      <span>Color groups</span>
      <ul className="palette">
        {editor.groups.map((group) => (
          <li key={group.paletteIndex}>
            <input
              type="color"
              value={group.fill}
              aria-label={`Group ${group.paletteIndex + 1} color: ${group.fill}`}
              onChange={(event) => recolorGroup(group.paletteIndex, event.target.value)}
            />
            <code>{group.fill}</code>
            <span className="hint">
              {group.shapes.length} {group.shapes.length === 1 ? 'shape' : 'shapes'}
            </span>
            <button
              type="button"
              className="link"
              aria-label={`Select all shapes of group ${group.paletteIndex + 1}`}
              onClick={() => {
                select(null);
                group.shapes.forEach((shape) => select(shape.id, true));
              }}
            >
              Select
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
