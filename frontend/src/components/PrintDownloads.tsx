import { ExportProgress } from './ExportProgress';

export type PrintFormat = '3mf' | 'stl' | 'stl-parts';

interface PrintDownloadsProps {
  /** Settings with errors: nothing can be downloaded. */
  invalid: boolean;
  exporting: boolean;
  /** Elapsed-time label of the running export ("" at first). */
  elapsed: string;
  error: string | null;
  /** Loaded filaments of mixed colors (their 3MF parts come in these), else null. */
  mixedFilaments: number | null;
  onDownload: (format: PrintFormat) => void;
  onCancel: () => void;
}

/** Download 3MF, STL or STL per color, with the export's progress and error. */
export function PrintDownloads({
  invalid,
  exporting,
  elapsed,
  error,
  mixedFilaments,
  onDownload,
  onCancel,
}: PrintDownloadsProps) {
  const disabled = invalid || exporting;
  return (
    <>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="actions actions--dock">
        <button
          type="button"
          className="primary"
          disabled={disabled}
          onClick={() => onDownload('3mf')}
        >
          Download 3MF
        </button>
        <button
          type="button"
          className="secondary"
          disabled={disabled}
          onClick={() => onDownload('stl')}
        >
          Download STL
        </button>
      </div>
      <button
        type="button"
        className="link"
        disabled={disabled}
        onClick={() => onDownload('stl-parts')}
      >
        STL per color (ZIP)
      </button>
      <span className="hint">
        {mixedFilaments !== null
          ? `3MF parts come only in the ${mixedFilaments} filament colors: assign each to the AMS slot with that filament.`
          : '3MF keeps one part per color, so the slicer assigns AMS slots automatically. Slicers without 3MF colors: load the ZIP’s STL files together as one multi-part object.'}
      </span>
      {exporting && <ExportProgress what="the model" elapsed={elapsed} onCancel={onCancel} />}
    </>
  );
}
