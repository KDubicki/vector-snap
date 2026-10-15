import type { PrintSettings } from '../lib/printPlan';
import { NumberField } from './NumberField';

interface PrinterTuningFieldsProps {
  settings: PrintSettings;
  errors: Record<string, string>;
  onChange: (change: Partial<PrintSettings>) => void;
}

/** Collapsed fine-tuning for the printer: first layer inset, smoother outlines, color gap. */
export function PrinterTuningFields({
  settings: print,
  errors,
  onChange: update,
}: PrinterTuningFieldsProps) {
  const changed = [print.elephantFootMm, print.simplifyMm, print.colorGapMm].filter(
    (value) => value !== 0,
  ).length;
  const invalid = errors.elephantFootMm ? 1 : 0;
  return (
    <details className="options__advanced">
      <summary>
        Printer tuning
        {invalid > 0 ? (
          <span className="options__changed options__changed--invalid">1 to fix</span>
        ) : (
          changed > 0 && <span className="options__changed">{changed} changed</span>
        )}
      </summary>
      <div className="options">
        <NumberField
          id="print-elephant-foot"
          label="Elephant's foot compensation (mm)"
          value={print.elephantFootMm}
          min={0}
          max={0.5}
          step={0.05}
          hint="Insets the first layer of the base (e.g. 0.2) where it bulges out on the bed. 0 = off."
          error={errors.elephantFootMm}
          onChange={(elephantFootMm) => update({ elephantFootMm })}
        />
        <NumberField
          id="print-simplify"
          label="Smooth outlines (mm)"
          value={print.simplifyMm}
          min={0}
          max={2}
          step={0.05}
          hint="Smaller files and faster slicing for traced photos (e.g. 0.1). 0 keeps every detail."
          onChange={(simplifyMm) => update({ simplifyMm })}
        />
        <NumberField
          id="print-color-gap"
          label="Gap between colors (mm)"
          value={print.colorGapMm}
          min={0}
          max={2}
          step={0.05}
          hint="Leaves room between colors, e.g. 0.1 for pieces printed apart and fitted together. 0 = colors touch."
          onChange={(colorGapMm) => update({ colorGapMm })}
        />
      </div>
    </details>
  );
}
