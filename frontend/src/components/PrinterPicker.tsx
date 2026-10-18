import { PRINTERS, printerById, type PrinterId } from '../lib/printers';

interface PrinterPickerProps {
  printer: PrinterId;
  onChoose: (id: PrinterId) => void;
}

/** Printer model of the 3D print step; a known printer checks nozzle and layer heights. */
export function PrinterPicker({ printer, onChoose }: PrinterPickerProps) {
  const chosen = printerById(printer);
  return (
    <div className="options">
      <div className="option">
        <label htmlFor="print-printer">Printer</label>
        <select
          id="print-printer"
          value={printer}
          aria-describedby="print-printer-hint"
          onChange={(event) => onChoose(event.target.value as PrinterId)}
        >
          {PRINTERS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <span id="print-printer-hint" className="hint">
          {chosen.buildMm
            ? `Build volume ${chosen.buildMm.join(' × ')} mm, ${chosen.slots} filaments (up to ${chosen.maxSlots}); nozzles and layer heights of Anycubic Slicer Next.`
            : 'Choose your printer to check nozzle, layer height and size.'}
        </span>
      </div>
    </div>
  );
}
