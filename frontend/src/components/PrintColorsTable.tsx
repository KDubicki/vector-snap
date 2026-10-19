import type { EditorDoc } from '../editor/model';
import type { LibraryFilament } from '../lib/filamentLibrary';
import { formatGrams } from '../lib/meshStats';
import { POOR_MATCH_DELTA_E } from '../lib/mixing';
import { layersToMm, reliefRaise, type PrintSettings } from '../lib/printPlan';

interface PrintColorsTableProps {
  doc: EditorDoc;
  settings: PrintSettings;
  /** Height above the base per printed color, in layers (`heightPlan().colors`). */
  colors: Map<number, number>;
  /** Nearest available library filament per palette index (flat and stepped colors). */
  nearest?: Map<number, { filament: LibraryFilament; delta: number }>;
  /** Filament per color (lowercase hex), from the backend; left out while unknown. */
  grams?: Map<string, number>;
  error?: string;
  onChange: (change: Partial<PrintSettings>) => void;
}

/** The nearest filament the user has; a poor match names it with its color difference. */
function FilamentMatch({ filament, delta }: { filament: LibraryFilament; delta: number }) {
  const title = `Nearest of your filaments: ${filament.name} (${filament.color}), ΔE ${delta.toFixed(1)}`;
  return delta > POOR_MATCH_DELTA_E ? (
    <small className="print-colors__match poor" title={title}>
      nearest: {filament.name}, ΔE {delta.toFixed(0)}
    </small>
  ) : (
    <small className="print-colors__match" title={title}>
      ≈ {filament.name}
    </small>
  );
}

/** Include or leave out each color and raise it by extra layers. */
export function PrintColorsTable({
  doc: editor,
  settings: print,
  colors,
  nearest,
  grams,
  error,
  onChange: update,
}: PrintColorsTableProps) {
  const mm = (layers: number) => layersToMm(layers, print.layerMm);
  const cutout = print.style === 'cutout';
  return (
    <fieldset className="color-heights print-colors">
      <legend>{cutout ? 'Cut out per color' : 'Height per color'}</legend>
      <ul>
        {editor.groups
          .filter((group) => group.shapes.length > 0)
          .map((group) => {
            const included = !print.excluded.includes(group.paletteIndex);
            const layers = colors.get(group.paletteIndex);
            const id = `print-raise-${group.paletteIndex}`;
            return (
              <li key={group.paletteIndex}>
                <input
                  type="checkbox"
                  checked={included}
                  aria-label={`${cutout ? 'Cut out' : 'Print'} ${group.fill}`}
                  onChange={() =>
                    update({
                      excluded: included
                        ? [...print.excluded, group.paletteIndex]
                        : print.excluded.filter((index) => index !== group.paletteIndex),
                    })
                  }
                />
                <span className="swatch" style={{ background: group.fill }} />
                <label htmlFor={id}>
                  {group.fill}
                  {included && nearest?.has(group.paletteIndex) && (
                    <FilamentMatch {...nearest.get(group.paletteIndex)!} />
                  )}
                </label>
                <input
                  id={id}
                  type="number"
                  min={0}
                  max={50}
                  step={1}
                  disabled={!included}
                  aria-label={`Extra layers for ${group.fill}`}
                  value={print.colorRaise[group.paletteIndex] ?? 0}
                  onChange={(event) =>
                    update({
                      colorRaise: {
                        ...print.colorRaise,
                        [group.paletteIndex]: Math.max(0, event.target.valueAsNumber || 0),
                      },
                    })
                  }
                />
                <span className="hint">
                  {layers === undefined ? (cutout ? 'solid' : 'left out') : `${mm(layers)} mm`}
                  {layers !== undefined &&
                    grams !== undefined &&
                    grams.size > 0 &&
                    (grams.has(group.fill) ? (
                      <span className="print-colors__grams">
                        {formatGrams(grams.get(group.fill)!)} g
                      </span>
                    ) : (
                      // Every shape thinner than the nozzle: the backend leaves it out.
                      <span
                        className="print-colors__grams"
                        title="Every shape of this color is thinner than the nozzle, so it is not printed."
                      >
                        too thin
                      </span>
                    ))}
                </span>
              </li>
            );
          })}
      </ul>
      <span className="hint">
        {cutout
          ? 'Ticked colors are cut out of the plate; the others stay solid. Extra layers cut deeper.'
          : 'The model starts flat: extra layers raise a whole color above the others.'}
      </span>
      {!cutout && (
        <div className="print-relief" role="group" aria-label="Automatic relief">
          <span className="hint">Automatic relief, one layer per color:</span>
          <button
            type="button"
            className="link"
            onClick={() => update({ colorRaise: reliefRaise(editor, print, 'dark') })}
          >
            dark on top
          </button>
          <button
            type="button"
            className="link"
            onClick={() => update({ colorRaise: reliefRaise(editor, print, 'light') })}
          >
            light on top
          </button>
        </div>
      )}
      {Object.values(print.colorRaise).some((layers) => layers > 0) && (
        <button type="button" className="link" onClick={() => update({ colorRaise: {} })}>
          Make all colors flat again
        </button>
      )}
      {error && <span className="field-error">{error}</span>}
    </fieldset>
  );
}
