import type { EditorDoc } from '../editor/model';
import { layersToMm, reliefRaise, type PrintSettings } from '../lib/printPlan';

interface PrintColorsTableProps {
  doc: EditorDoc;
  settings: PrintSettings;
  /** Height above the base per printed color, in layers (`heightPlan().colors`). */
  colors: Map<number, number>;
  error?: string;
  onChange: (change: Partial<PrintSettings>) => void;
}

/** Include or leave out each color and raise it by extra layers. */
export function PrintColorsTable({
  doc: editor,
  settings: print,
  colors,
  error,
  onChange: update,
}: PrintColorsTableProps) {
  const mm = (layers: number) => layersToMm(layers, print.layerMm);
  return (
    <fieldset className="color-heights print-colors">
      <legend>Height per color</legend>
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
                  aria-label={`Print ${group.fill}`}
                  onChange={() =>
                    update({
                      excluded: included
                        ? [...print.excluded, group.paletteIndex]
                        : print.excluded.filter((index) => index !== group.paletteIndex),
                    })
                  }
                />
                <span className="swatch" style={{ background: group.fill }} />
                <label htmlFor={id}>{group.fill}</label>
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
                  {layers === undefined ? 'left out' : `${mm(layers)} mm`}
                </span>
              </li>
            );
          })}
      </ul>
      <span className="hint">
        The model starts flat: extra layers raise a whole color above the others.
      </span>
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
      {Object.values(print.colorRaise).some((layers) => layers > 0) && (
        <button type="button" className="link" onClick={() => update({ colorRaise: {} })}>
          Make all colors flat again
        </button>
      )}
      {error && <span className="field-error">{error}</span>}
    </fieldset>
  );
}
