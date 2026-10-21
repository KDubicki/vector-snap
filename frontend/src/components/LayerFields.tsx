import { designHeightMm, layersToMm, widthForHeight, type PrintSettings } from '../lib/printPlan';
import { layerChoices, printerById } from '../lib/printers';
import { NumberField } from './NumberField';

interface LayerFieldsProps {
  settings: PrintSettings;
  errors: Record<string, string>;
  /** The design's height / width; with it the size can also be set by its height. */
  aspect?: number;
  onChange: (change: Partial<PrintSettings>) => void;
}

/** Size, printer layer height, base plate and color heights (in layers). */
export function LayerFields({
  settings: print,
  errors,
  aspect,
  onChange: update,
}: LayerFieldsProps) {
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
      {aspect !== undefined && aspect > 0 && (
        <NumberField
          id="print-height"
          label="Height (mm)"
          value={designHeightMm(print.widthMm, aspect)}
          min={0.1}
          max={designHeightMm(1000, aspect)}
          step={1}
          hint="Of the design; changes the width to match. A border or loop comes on top."
          onChange={(heightMm) => update({ widthMm: widthForHeight(heightMm, aspect) })}
        />
      )}
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
        label={
          print.style === 'stepped'
            ? 'Step per color (layers)'
            : print.style === 'cutout'
              ? 'Cut depth (layers)'
              : 'Colors (layers)'
        }
        value={print.colorLayers}
        min={1}
        max={50}
        step={1}
        suffix={`= ${mm(print.colorLayers)} mm`}
        error={errors.colorLayers}
        onChange={(colorLayers) => update({ colorLayers })}
      />
      {print.style === 'cutout' && (
        <>
          <div className="checkbox">
            <input
              id="print-cut-through"
              type="checkbox"
              checked={print.cutThrough}
              aria-describedby="print-cut-through-hint"
              onChange={(event) => update({ cutThrough: event.target.checked })}
            />
            <label htmlFor="print-cut-through">Cut through (stencil)</label>
          </div>
          <span id="print-cut-through-hint" className="hint">
            Holes through the plate instead of a recess. Areas inside letters — the middle of an O
            or A — print as loose pieces.
          </span>
        </>
      )}
    </div>
  );
}
