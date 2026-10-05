import { Suspense, lazy, useMemo, useState } from 'react';
import { ApiError, exportFile } from '../api/client';
import { serializeSvg } from '../editor/export';
import {
  EXPORT_FORMATS,
  defaultValues,
  exportFileName,
  layerHeightsJson,
  validate,
  validateColorHeights,
  type ColorHeight,
  type ExportValues,
} from '../lib/exportFormats';
import { useAppStore } from '../state/store';
import { ColorHeightsTable } from './ColorHeightsTable';
import type { PreviewRequest } from './ModelPreview';

// three.js is only downloaded when a 3D preview is opened.
const ModelPreview = lazy(() => import('./ModelPreview'));

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
  const [colorSettings, setColorSettings] = useState<Record<number, Partial<ColorHeight>>>({});
  const [preview, setPreview] = useState<PreviewRequest | null>(null);

  if (!editor) return null;

  const colorHeights: ColorHeight[] = editor.groups.map((group) => ({
    paletteIndex: group.paletteIndex,
    included: colorSettings[group.paletteIndex]?.included ?? true,
    height: colorSettings[group.paletteIndex]?.height ?? null,
  }));
  const colorHeightsError = format.perColorHeights ? validateColorHeights(colorHeights) : null;

  const update = (name: string, value: number | boolean | string) =>
    setValues((all) => ({ ...all, [format.id]: { ...current, [name]: value } }));

  const requestOptions = () =>
    format.perColorHeights
      ? { ...current, layer_heights: layerHeightsJson(colorHeights) }
      : current;
  const invalid = Object.keys(errors).length > 0 || colorHeightsError !== null;

  const run = async () => {
    setStatus('exporting');
    setError(null);
    try {
      const blob = await exportFile(format.id, serializeSvg(editor), requestOptions());
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
        {format.options.map((option) => {
          const id = `export-${format.id}-${option.name}`;
          const errorId = `${id}-error`;
          if (option.type === 'boolean') {
            return (
              <div key={option.name} className="checkbox">
                <input
                  id={id}
                  type="checkbox"
                  checked={Boolean(current[option.name])}
                  onChange={(event) => update(option.name, event.target.checked)}
                />
                <label htmlFor={id}>{option.label}</label>
              </div>
            );
          }
          return (
            <div key={option.name} className="option">
              <label htmlFor={id}>
                {option.label}
                {option.type === 'number' && option.unit ? ` (${option.unit})` : ''}
              </label>
              {option.type === 'choice' ? (
                <select
                  id={id}
                  value={String(current[option.name])}
                  onChange={(event) => update(option.name, event.target.value)}
                >
                  {option.choices.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={id}
                  type="number"
                  min={option.min}
                  max={option.max}
                  step={option.step}
                  value={Number.isFinite(current[option.name]) ? Number(current[option.name]) : ''}
                  aria-invalid={Boolean(errors[option.name])}
                  aria-describedby={errors[option.name] ? errorId : undefined}
                  onChange={(event) => update(option.name, event.target.valueAsNumber)}
                />
              )}
              {errors[option.name] && (
                <span id={errorId} className="field-error">
                  {errors[option.name]}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {format.perColorHeights && (
        <ColorHeightsTable
          groups={editor.groups}
          heights={colorHeights}
          values={current}
          error={colorHeightsError}
          onChange={(paletteIndex, change) =>
            setColorSettings((all) => ({
              ...all,
              [paletteIndex]: { ...all[paletteIndex], ...change },
            }))
          }
        />
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        {format.perColorHeights && (
          <button
            type="button"
            className="secondary"
            disabled={invalid}
            onClick={() => setPreview({ svg: serializeSvg(editor), options: requestOptions() })}
          >
            {preview ? 'Update 3D preview' : 'Preview 3D'}
          </button>
        )}
        <button
          type="button"
          className="secondary"
          disabled={status !== 'idle' || invalid}
          onClick={() => void run()}
        >
          {status === 'exporting' ? 'Exporting…' : `Export ${format.label}`}
        </button>
      </div>
      {preview && format.perColorHeights && (
        <Suspense fallback={<p className="hint">Loading 3D viewer…</p>}>
          <ModelPreview request={preview} />
        </Suspense>
      )}
    </details>
  );
}
