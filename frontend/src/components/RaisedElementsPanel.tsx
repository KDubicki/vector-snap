import type { EditorDoc } from '../editor/model';
import { layersToMm, setShapeRaise, sharedRaise, type PrintSettings } from '../lib/printPlan';

interface RaisedElementsPanelProps {
  doc: EditorDoc;
  settings: PrintSettings;
  /** Selected shape ids (may include shapes no longer in the document). */
  selected: string[];
  onClearSelection: () => void;
  onChange: (change: Partial<PrintSettings>) => void;
}

/** Raise the elements selected in the design by whole layers, or reset them. */
export function RaisedElementsPanel({
  doc: editor,
  settings: print,
  selected,
  onClearSelection,
  onChange: update,
}: RaisedElementsPanelProps) {
  const mm = (layers: number) => layersToMm(layers, print.layerMm);
  // Ids of the current document only: an edit in the SVG step may have removed shapes.
  const shapeIds = new Set(editor.groups.flatMap((group) => group.shapes.map((shape) => shape.id)));
  const selectedShapes = selected.filter((id) => shapeIds.has(id));
  const selectedRaise = sharedRaise(print.shapeRaise, selectedShapes);
  const raisedCount = Object.keys(print.shapeRaise).filter((id) => shapeIds.has(id)).length;
  const raiseSelected = (layers: number) =>
    update({ shapeRaise: setShapeRaise(print.shapeRaise, selectedShapes, Math.max(0, layers)) });

  return (
    <div className="field print-raise">
      <span>Raised elements</span>
      {selectedShapes.length === 0 ? (
        <span className="hint">
          Select elements in the design to print them higher than their color — e.g. the letters of
          a name or the eyes of a figure.
        </span>
      ) : (
        <>
          <div className="print-raise__row">
            <span>
              {selectedShapes.length} selected
              {selectedRaise === null && <span className="hint"> (different heights)</span>}
            </span>
            <div className="print-stepper" role="group" aria-label="Extra layers">
              <button
                type="button"
                aria-label="One layer lower"
                disabled={(selectedRaise ?? 0) <= 0}
                onClick={() => raiseSelected((selectedRaise ?? 0) - 1)}
              >
                −
              </button>
              <output aria-label="Extra layers for the selection">
                {selectedRaise === null ? '–' : `+${selectedRaise}`}
              </output>
              <button
                type="button"
                aria-label="One layer higher"
                disabled={(selectedRaise ?? 0) >= 50}
                onClick={() => raiseSelected((selectedRaise ?? 0) + 1)}
              >
                +
              </button>
            </div>
          </div>
          <span className="hint">
            {selectedRaise
              ? `+${selectedRaise} layers = ${mm(selectedRaise)} mm above their color`
              : 'Not raised: at their color’s height.'}
          </span>
          <div className="print-raise__actions">
            {selectedRaise !== 0 && (
              <button type="button" className="link" onClick={() => raiseSelected(0)}>
                Lower to their color
              </button>
            )}
            <button type="button" className="link" onClick={onClearSelection}>
              Clear selection
            </button>
          </div>
        </>
      )}
      {raisedCount > 0 && (
        <div className="print-raise__actions">
          <span className="hint">
            {raisedCount} {raisedCount === 1 ? 'element' : 'elements'} raised
          </span>
          <button type="button" className="link" onClick={() => update({ shapeRaise: {} })}>
            Reset all
          </button>
        </div>
      )}
    </div>
  );
}
