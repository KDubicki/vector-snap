import type { BaseShape, PrintSettings } from '../lib/printPlan';
import { NumberField } from './NumberField';

const BASE_SHAPES: { value: BaseShape; label: string }[] = [
  { value: 'outline', label: 'Follow the design' },
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'rounded', label: 'Rounded rectangle' },
  { value: 'circle', label: 'Circle' },
];

interface BasePlateFieldsProps {
  settings: PrintSettings;
  errors: Record<string, string>;
  onChange: (change: Partial<PrintSettings>) => void;
}

/** Base plate shape, border, raised rim, hanging loop, magnet pocket and detail filter. */
export function BasePlateFields({
  settings: print,
  errors,
  onChange: update,
}: BasePlateFieldsProps) {
  return (
    <div className="field">
      <span>Base plate</span>
      <div className="options">
        <div className="option">
          <label htmlFor="print-shape">Shape</label>
          <select
            id="print-shape"
            value={print.baseShape}
            onChange={(event) => update({ baseShape: event.target.value as BaseShape })}
          >
            {BASE_SHAPES.map((shape) => (
              <option key={shape.value} value={shape.value}>
                {shape.label}
              </option>
            ))}
          </select>
        </div>
        <NumberField
          id="print-margin"
          label="Border around the design (mm)"
          value={print.marginMm}
          min={0}
          max={100}
          step={0.5}
          onChange={(marginMm) => update({ marginMm })}
        />
        <NumberField
          id="print-rim"
          label="Raised rim (mm)"
          value={print.rimMm}
          min={0}
          max={50}
          step={0.5}
          hint="A frame this wide along the plate's edge, as high as the colors. 0 = none."
          error={errors.rimMm}
          onChange={(rimMm) => update({ rimMm })}
        />
        <NumberField
          id="print-loop"
          label="Hanging loop hole (mm)"
          value={print.loopHoleMm}
          min={0}
          max={20}
          step={0.5}
          hint="For a key ring, ribbon or hook. 0 = no loop."
          error={errors.loopHoleMm}
          onChange={(loopHoleMm) => update({ loopHoleMm })}
        />
        <NumberField
          id="print-magnet"
          label="Magnet pocket diameter (mm)"
          value={print.magnetMm}
          min={0}
          max={50}
          step={0.1}
          hint="Pocket in the back, ~0.2 mm wider than the magnet. 0 = none."
          onChange={(magnetMm) => update({ magnetMm })}
        />
        {print.magnetMm > 0 && (
          <NumberField
            id="print-magnet-depth"
            label="Magnet pocket depth (mm)"
            value={print.magnetDepthMm}
            min={0.1}
            max={20}
            step={0.1}
            error={errors.magnetDepthMm}
            onChange={(magnetDepthMm) => update({ magnetDepthMm })}
          />
        )}
        <NumberField
          id="print-nozzle"
          label="Drop details thinner than (mm)"
          value={print.nozzleMm}
          min={0}
          max={10}
          step={0.1}
          hint="Your nozzle width; thinner lines and specks cannot be printed."
          onChange={(nozzleMm) => update({ nozzleMm })}
        />
      </div>
    </div>
  );
}
