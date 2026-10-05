import { useMemo, useState } from 'react';
import { ApiError, exportFile } from '../api/client';
import { serializeSvg } from '../editor/export';
import {
  EXPORT_FORMATS,
  defaultValues,
  exportFileName,
  validate,
  type ExportValues,
} from '../lib/exportFormats';
import { useAppStore } from '../state/store';

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Convert the edited document to other formats via the backend (STL, …). */
export function ExportPanel() {
  const editor = useAppStore((s) => s.editor);
  const file = useAppStore((s) => s.file);
  const [formatId, setFormatId] = useState(EXPORT_FORMATS[0].id);
  const format = EXPORT_FORMATS.find((item) => item.id === formatId) ?? EXPORT_FORMATS[0];
  const [values, setValues] = useState<Record<string, ExportValues>>({});
  const current = values[format.id] ?? defaultValues(format);
  const errors = useMemo(() => validate(format, current), [format, current]);
  const [status, setStatus] = useState<'idle' | 'exporting'>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!editor) return null;

  const update = (name: string, value: number | boolean) =>
    setValues((all) => ({ ...all, [format.id]: { ...current, [name]: value } }));

  const run = async () => {
    setStatus('exporting');
    setError(null);
    try {
      const blob = await exportFile(format.id, serializeSvg(editor), current);
      download(blob, exportFileName(file?.name, format.extension));
    } catch (caught) {
      setError(
        caught instanceof ApiError || caught instanceof Error ? caught.message : 'Export failed',
      );
    } finally {
      setStatus('idle');
    }
  };

  return (
    <details className="field export">
      <summary>Export to other formats</summary>
      <div className="segmented" role="radiogroup" aria-label="Export format">
        {EXPORT_FORMATS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={item.id === format.id}
            className={item.id === format.id ? 'active' : ''}
            onClick={() => setFormatId(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <p className="hint">{format.description}</p>
      <div className="options">
        {format.options.map((option) =>
          option.type === 'number' ? (
            <label key={option.name}>
              {option.label}
              {option.unit ? ` (${option.unit})` : ''}
              <input
                type="number"
                min={option.min}
                max={option.max}
                step={option.step}
                value={Number.isFinite(current[option.name]) ? Number(current[option.name]) : ''}
                aria-invalid={Boolean(errors[option.name])}
                onChange={(event) => update(option.name, event.target.valueAsNumber)}
              />
              {errors[option.name] && <span className="field-error">{errors[option.name]}</span>}
            </label>
          ) : (
            <label key={option.name} className="checkbox">
              <input
                type="checkbox"
                checked={Boolean(current[option.name])}
                onChange={(event) => update(option.name, event.target.checked)}
              />
              {option.label}
            </label>
          ),
        )}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="secondary"
        disabled={status !== 'idle' || Object.keys(errors).length > 0}
        onClick={() => void run()}
      >
        {status === 'exporting' ? 'Exporting…' : `Export ${format.label}`}
      </button>
    </details>
  );
}
