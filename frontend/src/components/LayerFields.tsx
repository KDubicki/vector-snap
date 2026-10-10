import { layersToMm, type PrintSettings } from '../lib/printPlan';
import { NumberField } from './NumberField';

const PRINTER_LAYERS = [0.08, 0.12, 0.16, 0.2, 0.24, 0.28];

interface LayerFieldsProps {
  settings: PrintSettings;
  errors: Record<string, string>;
  onChange: (change: Partial<PrintSettings>) => void;
}

/** Width, printer layer height, base plate and color heights (in layers). */
export function LayerFields({ settings: print, errors, onChange: update }: LayerFieldsProps) {
  const mm = (layers: number) => layersToMm(layers, print.layerMm);
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
          onChange={(event) => update({ layerMm: Number(event.target.value) })}
        >
          {PRINTER_LAYERS.map((value) => (
            <option key={value} value={value}>
              {value} mm
            </option>
          ))}
        </select>
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
