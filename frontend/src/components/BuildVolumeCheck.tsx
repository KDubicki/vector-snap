import type { PrintSettings } from '../lib/printPlan';
import { buildProblems, copiesThatFit, fitWidthMm, tileGrid, type Printer } from '../lib/printers';
import type { ModelSize } from '../types/api';

interface BuildVolumeCheckProps {
  printer: Printer;
  settings: PrintSettings;
  size: ModelSize | null;
  onChange: (change: Partial<PrintSettings>) => void;
  /** Download the model cut into tiles that fit the bed; undefined while one is running. */
  onTiles?: () => void;
}

const mm = (value: number) => Number(value.toFixed(1));

/** Whether the model fits the printer's build volume, and a fix when it is too wide. */
export function BuildVolumeCheck({
  printer,
  settings,
  size,
  onChange,
  onTiles,
}: BuildVolumeCheckProps) {
  if (!printer.buildMm) return null;
  if (!size) {
    return (
      <p className="hint print-build" role="status">
        Checking the size for the {printer.label}…
      </p>
    );
  }
  const problems = buildProblems(size, printer);
  const model = `${mm(size.x_mm)} × ${mm(size.y_mm)} × ${mm(size.z_mm)} mm`;
  if (!problems.length) {
    return (
      <p className="hint print-build" role="status">
        Model {model} — fits the {printer.label} ({printer.buildMm.join(' × ')} mm).
      </p>
    );
  }
  // A batch of copies too large for the bed: fewer copies, not a smaller or tiled model.
  const batch = settings.copies > 1;
  const fewer = batch ? copiesThatFit(size, settings.copies, printer) : null;
  const width = batch ? null : fitWidthMm(settings, size, printer);
  const tiles = batch ? null : tileGrid(size, printer);
  return (
    <div className="print-build print-build--over" role="status">
      <p className="field-error">
        Model {model} is too large for the {printer.label}: {problems.join('; ')}.
      </p>
      {fewer !== null && (
        <button type="button" className="secondary" onClick={() => onChange({ copies: fewer })}>
          Print {fewer} {fewer === 1 ? 'copy' : 'copies'} (fit the bed)
        </button>
      )}
      {width !== null && (
        <button type="button" className="secondary" onClick={() => onChange({ widthMm: width })}>
          Fit to the bed ({width} mm wide)
        </button>
      )}
      {tiles && (
        <>
          <button type="button" className="secondary" disabled={!onTiles} onClick={onTiles}>
            Download in {tiles.columns * tiles.rows} tiles (3MF, ZIP)
          </button>
          <p className="hint">
            Keeps the size: {tiles.columns} × {tiles.rows} tiles of {mm(tiles.xMm)} ×{' '}
            {mm(tiles.yMm)} mm, printed one by one and joined edge to edge.
          </p>
        </>
      )}
    </div>
  );
}
