import { formatDuration } from '../lib/elapsed';
import type { Printer } from '../lib/printers';
import type { ColorChanges } from '../types/api';

interface ColorChangesSummaryProps {
  printer: Printer;
  changes: ColorChanges | null;
}

/** Filament changes of the print on a multi-color printer, with their time and purge. */
export function ColorChangesSummary({ printer, changes }: ColorChangesSummaryProps) {
  if (!printer.changeS || !changes) return null;
  if (!changes.changes) {
    return (
      <p className="hint print-changes" role="status">
        No filament changes on the {printer.label}.
      </p>
    );
  }
  return (
    <p className="hint print-changes" role="status">
      ≈ <strong>{changes.changes} filament changes</strong> on the {printer.label}: about{' '}
      {formatDuration(changes.change_time_s)} and {changes.purge_g} g of purged filament (up to{' '}
      {changes.max_colors_per_layer} colors per layer). Every layer with n colors costs n − 1
      changes, so colors left out or kept thin save the most.
    </p>
  );
}
