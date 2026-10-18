import type { PrintSettings } from '../lib/printPlan';
import { buildProblems, fitWidthMm, type Printer } from '../lib/printers';
import type { ModelSize } from '../types/api';

interface BuildVolumeCheckProps {
  printer: Printer;
  settings: PrintSettings;
  size: ModelSize | null;
  onChange: (change: Partial<PrintSettings>) => void;
}

const mm = (value: number) => Number(value.toFixed(1));

/** Whether the model fits the printer's build volume, and a fix when it is too wide. */
export function BuildVolumeCheck({ printer, settings, size, onChange }: BuildVolumeCheckProps) {
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
  const width = fitWidthMm(settings, size, printer);
  return (
    <div className="print-build print-build--over" role="status">
      <p className="field-error">
        Model {model} is too large for the {printer.label}: {problems.join('; ')}.
      </p>
      {width !== null && (
        <button type="button" className="secondary" onClick={() => onChange({ widthMm: width })}>
          Fit to the bed ({width} mm wide)
        </button>
      )}
    </div>
  );
}
