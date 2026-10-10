interface ExportProgressProps {
  /** What is being built, e.g. "the model" or "the STL file". */
  what: string;
  elapsed: string;
  onCancel: () => void;
}

/** "Building … · 12 s  Cancel" line shown while an export runs. */
export function ExportProgress({ what, elapsed, onCancel }: ExportProgressProps) {
  return (
    <p className="hint export__progress" role="status">
      <span className="spinner" aria-hidden="true" />
      Building {what}
      {elapsed && ` · ${elapsed}`}
      <button type="button" className="link" onClick={onCancel}>
        Cancel
      </button>
    </p>
  );
}
