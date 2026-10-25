import type { MergedColor } from '../types/api';

interface MergedColorsProps {
  merged: MergedColor[];
}

const percent = (share: number) => `${(share * 100).toFixed(1)}%`;

/** Why a color was merged: it looked like another, or covered too little of the image. */
function reason(item: MergedColor): string {
  return item.reason === 'similar'
    ? `looks the same, ΔE ${item.delta_e.toFixed(1)}`
    : `only ${percent(item.coverage)} of the image`;
}

/** Colors that joined another palette color: similar ones and too small ones. */
export function MergedColors({ merged }: MergedColorsProps) {
  if (!merged.length) return null;
  return (
    <div className="field merged-colors" role="status" aria-label="Merged colors">
      <span className="hint">
        {merged.length === 1 ? '1 color' : `${merged.length} colors`} merged into another:
      </span>
      <ul>
        {merged.map((item) => (
          <li key={item.hex}>
            <span className="merged-colors__swatch" style={{ background: item.hex }} />
            <code>{item.hex}</code>→
            <span className="merged-colors__swatch" style={{ background: item.into }} />
            <code>{item.into}</code>
            <span className="hint">{reason(item)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
