interface PrintUndoProps {
  /** What the last bulk change applied, e.g. "Keychain" or "sign.print.json". */
  what: string | null;
  onUndo: () => void;
}

/** Offers to undo the last project or print settings file, which change many settings. */
export function PrintUndo({ what, onUndo }: PrintUndoProps) {
  if (!what) return null;
  return (
    <p className="hint print-undo" role="status">
      Applied {what}.{' '}
      <button type="button" className="link" onClick={onUndo}>
        Undo
      </button>
    </p>
  );
}
