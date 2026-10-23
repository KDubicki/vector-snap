import { formatGrams, formatMillimetres } from '../lib/meshStats';
import type { ModelSize } from '../types/api';

interface PrintSummaryProps {
  /** Total height (mm) and printer layers of the model, base plate included. */
  heightMm: number;
  layers: number;
  baseMm: number;
  /** Size of the model as exported; null while unknown. */
  size: ModelSize | null | undefined;
  /** Solid filament of the model (grams); undefined while unknown. */
  grams: number | undefined;
}

/** Height, footprint and filament of the print as tiles, the numbers to check at a glance. */
export function PrintSummary({ heightMm, layers, baseMm, size, grams }: PrintSummaryProps) {
  return (
    <dl className="print-summary" role="status" aria-label="Print summary">
      <div className="print-summary__tile">
        <dt>Height</dt>
        <dd>{heightMm} mm</dd>
        <dd className="hint">
          {layers} layers · base {baseMm} mm
        </dd>
      </div>
      <div className="print-summary__tile">
        <dt>Footprint</dt>
        <dd>
          {size ? `${formatMillimetres(size.x_mm)} × ${formatMillimetres(size.y_mm)} mm` : '—'}
        </dd>
      </div>
      <div className="print-summary__tile">
        <dt>Filament</dt>
        <dd>{grams !== undefined ? `${formatGrams(grams)} g` : '—'}</dd>
        <dd className="hint">solid model</dd>
      </div>
    </dl>
  );
}
