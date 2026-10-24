import { formatGrams } from '../lib/meshStats';
import type { PrintSettings } from '../lib/printPlan';
import { NumberField } from './NumberField';

interface OutlineFieldsProps {
  settings: PrintSettings;
  errors: Record<string, string>;
  /** Filament per color and its 3MF slot (lowercase hex), from the backend. */
  grams?: Map<string, number>;
  slots?: Map<string, number>;
  onChange: (change: Partial<PrintSettings>) => void;
}

/** Outlines along every color's edges, in a filament of their own (flat and stepped colors). */
export function OutlineFields({
  settings: print,
  errors,
  grams,
  slots,
  onChange: update,
}: OutlineFieldsProps) {
  const color = print.outlineColor.toLowerCase();
  const slot = slots?.get(color);
  const used = grams?.get(color);
  return (
    <div className="field">
      <span>Outlines</span>
      <div className="options">
        <NumberField
          id="print-outline"
          label="Outline width (mm)"
          value={print.outlineMm}
          min={0}
          max={5}
          step={0.1}
          hint="A line along every color's edges in its own filament, like a comic. 0 = none; at least the nozzle width."
          error={errors.outlineMm}
          onChange={(outlineMm) => update({ outlineMm })}
        />
        {print.outlineMm > 0 && (
          <>
            <div className="option print-outline-color">
              <label htmlFor="print-outline-color">Outline filament</label>
              <div className="print-number">
                <input
                  id="print-outline-color"
                  type="color"
                  value={color}
                  onChange={(event) => update({ outlineColor: event.target.value })}
                />
                <code>{color}</code>
                {(slot !== undefined || used !== undefined) && (
                  <span className="hint">
                    {slot !== undefined && `filament ${slot}`}
                    {slot !== undefined && used !== undefined && ' · '}
                    {used !== undefined && `${formatGrams(used)} g`}
                  </span>
                )}
              </div>
            </div>
            <div className="checkbox">
              <input
                id="print-outline-raised"
                type="checkbox"
                checked={print.outlineRaised}
                onChange={(event) => update({ outlineRaised: event.target.checked })}
              />
              <label htmlFor="print-outline-raised">One layer above the colors</label>
            </div>
            <span className="hint">
              Stands out like a cookie cutter's edge; otherwise the top stays flat.
            </span>
          </>
        )}
      </div>
    </div>
  );
}
