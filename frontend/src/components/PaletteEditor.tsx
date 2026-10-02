import type { PaletteColor } from '../types/api';

interface PaletteEditorProps {
  palette: PaletteColor[];
  overrides: Record<number, string>;
  onChange: (index: number, hex: string) => void;
}

export function PaletteEditor({ palette, overrides, onChange }: PaletteEditorProps) {
  // TODO: merge colors, reset, hover highlighting (docs/07-frontend.md#step-2--colors--palette)
  return (
    <ul className="palette">
      {palette.map((color) => {
        const hex = overrides[color.index] ?? color.hex;
        return (
          <li key={color.index}>
            <input
              type="color"
              value={hex}
              aria-label={`Palette color ${color.index}: ${hex}`}
              onChange={(event) => onChange(color.index, event.target.value)}
            />
            <code>{hex}</code>
            {color.coverage !== undefined && <span>{(color.coverage * 100).toFixed(1)}%</span>}
          </li>
        );
      })}
    </ul>
  );
}
