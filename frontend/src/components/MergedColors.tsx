import type { MergedColor } from '../types/api';

interface MergedColorsProps {
  merged: MergedColor[];
  /** The share below which colors were merged (%). */
  minCoverage: number;
}

const percent = (share: number) => `${(share * 100).toFixed(1)}%`;

/** Colors that covered too little of the image and joined their nearest color. */
export function MergedColors({ merged, minCoverage }: MergedColorsProps) {
  if (!merged.length) return null;
  return (
    <div className="field merged-colors" role="status" aria-label="Merged colors">
      <span className="hint">
        {merged.length === 1 ? '1 color' : `${merged.length} colors`} under {minCoverage}% of the
        image joined the nearest color:
      </span>
      <ul>
        {merged.map((item) => (
          <li key={item.hex}>
            <span className="merged-colors__swatch" style={{ background: item.hex }} />
            <code>{item.hex}</code> ({percent(item.coverage)}) →
            <span className="merged-colors__swatch" style={{ background: item.into }} />
            <code>{item.into}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}
