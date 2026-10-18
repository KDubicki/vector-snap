import type { PrintSettings } from '../lib/printPlan';
import { PRINTERS, printerById, type PrinterId } from '../lib/printers';
import { NumberField } from './NumberField';

interface PrinterPickerProps {
  settings: PrintSettings;
  onChange: (change: Partial<PrintSettings>) => void;
}

/**
 * Printer model of the 3D print step; a known printer checks nozzle, layer heights, size
 * and the number of loaded filaments.
 */
export function PrinterPicker({ settings, onChange }: PrinterPickerProps) {
  const chosen = printerById(settings.printer);
  return (
    <div className="options">
      <div className="option">
        <label htmlFor="print-printer">Printer</label>
        <select
          id="print-printer"
          value={settings.printer}
          aria-describedby="print-printer-hint"
          onChange={(event) => onChange({ printer: event.target.value as PrinterId })}
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
      {chosen.slots && chosen.maxSlots && (
        <NumberField
          id="print-slots"
          label="Loaded filaments"
          value={settings.filamentSlots}
          min={1}
          max={chosen.maxSlots}
          step={1}
          hint={`${chosen.slots} in the ACE Gen 2; ACE 2 Pro units add more, up to ${chosen.maxSlots}.`}
          onChange={(filamentSlots) => onChange({ filamentSlots })}
        />
      )}
    </div>
  );
}
