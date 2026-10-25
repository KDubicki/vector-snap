import type { PrintCheck } from '../types/api';

interface ThinShapesCheckProps {
  check: PrintCheck | null;
  /** Select the thin shapes in the design view, to find (and raise or leave out) them. */
  onSelect: (ids: string[]) => void;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Shapes narrower than the nozzle: the slicer skips them and the export drops them. */
export function ThinShapesCheck({ check, onSelect }: ThinShapesCheckProps) {
  if (!check?.shapes.length) return null;
  const vanishing = check.shapes.filter((shape) => shape.vanishes).length;
  const lost = vanishing === check.shapes.length ? 'will not print' : 'will print only in part';
  return (
    <div className="print-thin" role="status">
      <p className="field-error">
        {plural(check.shapes.length, 'shape')} {check.shapes.length === 1 ? 'is' : 'are'} narrower
        than the {check.nozzle_mm} mm nozzle and {lost}
        {vanishing > 0 && vanishing < check.shapes.length ? ` (${vanishing} not at all)` : ''}. A
        wider model or a finer nozzle prints them.
      </p>
      <button
        type="button"
        className="secondary"
        onClick={() => onSelect(check.shapes.map((shape) => shape.id))}
      >
        Show them in the design
      </button>
    </div>
  );
}
