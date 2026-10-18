import type { Printer } from '../lib/printers';

interface FilamentSlotsCheckProps {
  printer: Printer;
  needed: number;
  loaded: number;
  /** Fewest colors the palette step converts to. */
  minColors: number;
  onReduce: (colors: number) => void;
}

/** Warns when the print needs more filaments than the printer has loaded. */
export function FilamentSlotsCheck({
  printer,
  needed,
  loaded,
  minColors,
  onReduce,
}: FilamentSlotsCheckProps) {
  if (!printer.slots || needed <= loaded) return null;
  return (
    <div className="print-build print-build--over" role="status">
      <p className="field-error">
        The design needs {needed} filaments; {loaded === 1 ? '1 is' : `${loaded} are`} loaded on the{' '}
        {printer.label}. Leave colors out above, load more (up to {printer.maxSlots} with ACE 2 Pro)
        or convert the image with fewer colors.
      </p>
      {loaded >= minColors && (
        <button type="button" className="secondary" onClick={() => onReduce(loaded)}>
          Use {loaded} colors
        </button>
      )}
    </div>
  );
}
