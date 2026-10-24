import { BASE_SHAPES } from '../lib/baseShapes';
import { screwBorderMm } from '../lib/printPlan';
import type { BaseShape, LoopPosition, PrintSettings } from '../lib/printPlan';
import { NumberField } from './NumberField';

const SCREW_HOLES = [
  { value: 0, label: 'None' },
  { value: 2, label: '2, by the sides' },
  { value: 4, label: '4, in the corners' },
];

const LOOP_POSITIONS: { value: LoopPosition; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'right', label: 'Right' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'left', label: 'Left' },
];

interface BasePlateFieldsProps {
  settings: PrintSettings;
  errors: Record<string, string>;
  onChange: (change: Partial<PrintSettings>) => void;
}

/** Base plate shape, border, raised rim, hanging loop, magnet pocket, inlay and mirror. */
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
        {print.loopHoleMm > 0 && (
          <div className="option">
            <label htmlFor="print-loop-position">Loop on the</label>
            <select
              id="print-loop-position"
              value={print.loopPosition}
              onChange={(event) => update({ loopPosition: event.target.value as LoopPosition })}
            >
              {LOOP_POSITIONS.map((position) => (
                <option key={position.value} value={position.value}>
                  {position.label}
                </option>
              ))}
            </select>
          </div>
        )}
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
        {print.magnetMm > 0 && (
          <NumberField
            id="print-magnet-count"
            label="Magnets"
            value={print.magnetCount}
            min={1}
            max={4}
            step={1}
            hint="Two or more, spread along the longer side, keep long signs from tilting."
            error={errors.magnetCount}
            onChange={(magnetCount) => update({ magnetCount })}
          />
        )}
        <div className="option">
          <label htmlFor="print-screw-holes">Screw holes</label>
          <select
            id="print-screw-holes"
            value={print.screwHoles}
            aria-invalid={Boolean(errors.screwHoles)}
            aria-describedby={errors.screwHoles ? 'print-screw-holes-error' : undefined}
            onChange={(event) => update({ screwHoles: Number(event.target.value) })}
          >
            {SCREW_HOLES.map((holes) => (
              <option key={holes.value} value={holes.value}>
                {holes.label}
              </option>
            ))}
          </select>
          <span className="hint">
            {print.screwHoles > 0
              ? `Through the plate beside the design: needs a border of about ${screwBorderMm(print.screwHoleMm)} mm, or a rectangle plate.`
              : 'To screw a sign to a wall.'}
          </span>
          {errors.screwHoles && (
            <span id="print-screw-holes-error" className="field-error">
              {errors.screwHoles}
            </span>
          )}
        </div>
        {print.screwHoles > 0 && (
          <NumberField
            id="print-screw-hole"
            label="Screw hole diameter (mm)"
            value={print.screwHoleMm}
            min={0.1}
            max={10}
            step={0.1}
            hint="A little wider than the screw, e.g. 4 for 3.5 mm wood screws."
            error={errors.screwHoleMm}
            onChange={(screwHoleMm) => update({ screwHoleMm })}
          />
        )}
        {print.style !== 'cutout' && (
          <>
            <div className="checkbox">
              <input
                id="print-inlay"
                type="checkbox"
                checked={print.inlay}
                aria-invalid={Boolean(errors.inlay)}
                aria-describedby={errors.inlay ? 'print-inlay-error' : 'print-inlay-hint'}
                onChange={(event) => update({ inlay: event.target.checked })}
              />
              <label htmlFor="print-inlay">Set the colors into the base (flat top)</label>
            </div>
            <span id="print-inlay-hint" className="hint">
              Colors sink their height into the plate, so the top is one flat surface — coasters and
              signs on multi-color printers.
            </span>
            {errors.inlay && (
              <span id="print-inlay-error" className="field-error">
                {errors.inlay}
              </span>
            )}
          </>
        )}
        <div className="checkbox">
          <input
            id="print-mirror"
            type="checkbox"
            checked={print.mirror}
            aria-describedby="print-mirror-hint"
            onChange={(event) => update({ mirror: event.target.checked })}
          />
          <label htmlFor="print-mirror">Mirror (stamps: print face down)</label>
        </div>
        <span id="print-mirror-hint" className="hint">
          Flips the model left to right, so a stamp — or a model glued face down behind glass —
          reads the right way round.
        </span>
      </div>
    </div>
  );
}
