import type { PaletteColor } from '../types/api';

interface PaletteEditorProps {
  palette: PaletteColor[];
  overrides: Record<number, string>;
  onChange: (index: number, hex: string) => void;
  onReset: (index: number) => void;
  onResetAll: () => void;
}

export function PaletteEditor({
  palette,
  overrides,
  onChange,
  onReset,
  onResetAll,
}: PaletteEditorProps) {
  const changed = Object.keys(overrides).length > 0;

  return (
    <div className="field">
      <div className="field__header">
        <span>Palette</span>
        <button type="button" className="link" onClick={onResetAll} disabled={!changed}>
          Reset all
        </button>
      </div>
      <ul className="palette">
        {palette.map((color) => {
          const hex = overrides[color.index] ?? color.hex;
          const isChanged = color.index in overrides;
          return (
            <li key={color.index}>
              <input
                type="color"
                value={hex}
                aria-label={`Palette color ${color.index + 1}: ${hex}`}
                onChange={(event) => onChange(color.index, event.target.value)}
              />
              <code>{hex}</code>
              {color.coverage !== undefined && (
                <span className="coverage" title="Share of the image">
                  <span style={{ width: `${Math.max(color.coverage * 100, 1)}%` }} />
                  {(color.coverage * 100).toFixed(1)}%
                </span>
              )}
              {isChanged && (
                <button
                  type="button"
                  className="link"
                  onClick={() => onReset(color.index)}
                  title={`Restore ${color.hex}`}
                >
                  Reset
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="hint">Tip: give two colors the same value to merge them.</p>
    </div>
  );
}
