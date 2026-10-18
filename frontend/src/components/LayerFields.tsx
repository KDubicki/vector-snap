import { layersToMm, type PrintSettings } from '../lib/printPlan';
import { layerChoices, printerById } from '../lib/printers';
import { NumberField } from './NumberField';

interface LayerFieldsProps {
  settings: PrintSettings;
  errors: Record<string, string>;
  onChange: (change: Partial<PrintSettings>) => void;
}

/** Width, printer layer height, base plate and color heights (in layers). */
export function LayerFields({ settings: print, errors, onChange: update }: LayerFieldsProps) {
  const mm = (layers: number) => layersToMm(layers, print.layerMm);
  const choices = layerChoices(printerById(print.printer), print.nozzleMm);
  // A layer height the printer does not offer stays visible (and is flagged).
  const layers = choices.includes(print.layerMm)
    ? choices
    : [...choices, print.layerMm].sort((a, b) => a - b);
  return (
    <div className="options">
      <NumberField
        id="print-width"
        label="Width (mm)"
        value={print.widthMm}
        min={1}
        max={1000}
        step={1}
        error={errors.widthMm}
        onChange={(widthMm) => update({ widthMm })}
      />
      <div className="option">
        <label htmlFor="print-layer">Printer layer height</label>
        <select
          id="print-layer"
          value={print.layerMm}
          aria-invalid={errors.layerMm ? true : undefined}
          aria-describedby={errors.layerMm ? 'print-layer-error' : undefined}
          onChange={(event) => update({ layerMm: Number(event.target.value) })}
        >
          {layers.map((value) => (
            <option key={value} value={value}>
              {value} mm
            </option>
          ))}
        </select>
        {errors.layerMm && (
          <span id="print-layer-error" className="field-error">
            {errors.layerMm}
          </span>
        )}
      </div>
      <NumberField
        id="print-base"
        label="Base plate (layers)"
        value={print.baseLayers}
        min={0}
        max={100}
        step={1}
        suffix={`= ${mm(print.baseLayers)} mm`}
        error={errors.baseLayers}
        onChange={(baseLayers) => update({ baseLayers })}
      />
      <NumberField
        id="print-color"
        label={print.style === 'stepped' ? 'Step per color (layers)' : 'Colors (layers)'}
        value={print.colorLayers}
        min={1}
        max={50}
        step={1}
        suffix={`= ${mm(print.colorLayers)} mm`}
        error={errors.colorLayers}
        onChange={(colorLayers) => update({ colorLayers })}
      />
    </div>
  );
}
