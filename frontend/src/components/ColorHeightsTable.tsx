import type { ColorGroup } from '../editor/model';
import {
  autoLayerHeight,
  stackPositions,
  type ColorHeight,
  type ExportValues,
} from '../lib/exportFormats';

interface ColorHeightsTableProps {
  groups: ColorGroup[];
  heights: ColorHeight[];
  values: ExportValues;
  error: string | null;
  onChange: (paletteIndex: number, change: Partial<ColorHeight>) => void;
}

/** Per-color extrusion heights for 3D exports; an empty height means "automatic". */
export function ColorHeightsTable({
  groups,
  heights,
  values,
  error,
  onChange,
}: ColorHeightsTableProps) {
  const positions = stackPositions(
    groups.map((group) => group.fill),
    values.stack_order,
  );
  return (
    <fieldset className="color-heights">
      <legend>Height per color (above the base)</legend>
      <ul>
        {groups.map((group, index) => {
          const setting = heights.find((h) => h.paletteIndex === group.paletteIndex);
          const included = setting?.included ?? true;
          const id = `color-height-${group.paletteIndex}`;
          return (
            <li key={group.paletteIndex}>
              <input
                type="checkbox"
                checked={included}
                aria-label={`Include ${group.fill}`}
                onChange={(event) =>
                  onChange(group.paletteIndex, { included: event.target.checked })
                }
              />
              <span className="swatch" style={{ background: group.fill }} />
              <label htmlFor={id}>{group.fill}</label>
              <input
                id={id}
                type="number"
                min={0.1}
                max={100}
                step={0.2}
                disabled={!included}
                placeholder={`auto ${autoLayerHeight(positions[index], values)}`}
                value={setting?.height ?? ''}
                onChange={(event) =>
                  onChange(group.paletteIndex, {
                    height: event.target.value === '' ? null : event.target.valueAsNumber,
                  })
                }
              />
              <span className="hint">mm</span>
            </li>
          );
        })}
      </ul>
      {error && <span className="field-error">{error}</span>}
    </fieldset>
  );
}
