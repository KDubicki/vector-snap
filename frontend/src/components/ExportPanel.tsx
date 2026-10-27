import { Fragment, Suspense, lazy, useMemo, useState } from 'react';
import { errorMessage, exportFile, exportLithophane, getFilamentPlan } from '../api/client';
import { serializeSvg } from '../editor/export';
import {
  EXPORT_FORMATS,
  changedCount,
  defaultValues,
  exportFileName,
  formatExtension,
  modelTitle,
  optionSections,
  validate,
  type ExportOption,
  type ExportValues,
} from '../lib/exportFormats';
import { layerHeightsJson, validateColorHeights, type ColorHeight } from '../lib/colorHeights';
import { rasterSize, svgToPng } from '../lib/raster';
import { useExport } from '../lib/useExport';
import { useAppStore } from '../state/store';
import type { FilamentPlan } from '../types/api';
import { ColorHeightsTable } from './ColorHeightsTable';
import { ExportProgress } from './ExportProgress';
import { FilamentPlanView } from './FilamentPlanView';
import type { PreviewRequest } from './ModelPreview';

// three.js is only downloaded when a 3D preview is opened.
const ModelPreview = lazy(() => import('./ModelPreview'));

/** Summary of a collapsed option section: invalid options first, else changed ones. */
function SectionBadge({ invalid, changed }: { invalid: number; changed: number }) {
  if (invalid > 0) {
    return <span className="options__changed options__changed--invalid">{invalid} to fix</span>;
  }
  return changed > 0 ? <span className="options__changed">{changed} changed</span> : null;
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
  const job = useExport();
  const [colorSettings, setColorSettings] = useState<Record<number, Partial<ColorHeight>>>({});
  const [preview, setPreview] = useState<PreviewRequest | null>(null);
  // Cleared whenever an option changes, so a shown plan always matches the options.
  const [plan, setPlan] = useState<FilamentPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  if (!editor) return null;

  const colorHeights: ColorHeight[] = editor.groups.map((group) => ({
    paletteIndex: group.paletteIndex,
    included: colorSettings[group.paletteIndex]?.included ?? true,
    height: colorSettings[group.paletteIndex]?.height ?? null,
  }));
  const colorHeightsError = format.perColorHeights ? validateColorHeights(colorHeights) : null;

  const update = (name: string, value: number | boolean | string) => {
    setValues((all) => ({ ...all, [format.id]: { ...current, [name]: value } }));
    setPlan(null);
  };

  const requestOptions = () =>
    format.perColorHeights
      ? { ...current, layer_heights: layerHeightsJson(colorHeights) }
      : current;
  // 3MF models are named after the image in the slicer.
  const titled = (options: ExportValues) => ({ ...options, title: modelTitle(file?.name) });
  const invalid = Object.keys(errors).length > 0 || colorHeightsError !== null;
  const raster =
    format.client && !invalid
      ? rasterSize(editor.width, editor.height, Number(current.width_px))
      : null;

  const render = (signal: AbortSignal): Promise<Blob> => {
    const svg = serializeSvg(editor);
    if (raster) {
      return svgToPng(svg, raster, current.background === 'white' ? '#ffffff' : null);
    }
    if (format.source === 'image') {
      if (!file) throw new Error('The original image is no longer available.');
      return exportLithophane(file, current, signal);
    }
    const options = requestOptions();
    return exportFile(format.id, svg, format.id === '3mf' ? titled(options) : options, signal);
  };

  // STL/3MF preview the colored 3MF; a lithophane previews its own STL.
  const previewRequest = (): PreviewRequest | null => {
    if (format.source === 'image') {
      if (!file) return null;
      const options = current;
      return { kind: 'stl', load: (signal) => exportLithophane(file, options, signal) };
    }
    const svg = serializeSvg(editor);
    const options = titled(requestOptions());
    return { kind: '3mf', load: (signal) => exportFile('3mf', svg, options, signal) };
  };
  const canPreview = format.perColorHeights || (format.source === 'image' && file !== null);

  const showPlan = async () => {
    setPlanning(true);
    job.setError(null);
    try {
      setPlan(await getFilamentPlan(serializeSvg(editor), requestOptions()));
    } catch (caught) {
      job.setError(errorMessage(caught, 'Planning failed'));
    } finally {
      setPlanning(false);
    }
  };

  const renderOption = (option: ExportOption) => {
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
        {option.hint && <span className="hint">{option.hint}</span>}
        {errors[option.name] && (
          <span id={errorId} className="field-error">
            {errors[option.name]}
          </span>
        )}
      </div>
    );
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
            onClick={() => {
              setFormatId(item.id);
              setPlan(null);
              // A lithophane is a different model: drop a preview of the colored one.
              if (item.source !== format.source) setPreview(null);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <p className="hint">{format.description}</p>
      <div className="options">
        {optionSections(format).map((section) =>
          section.name === null ? (
            <Fragment key="main">{section.options.map(renderOption)}</Fragment>
          ) : (
            <details
              key={section.name}
              className="options__advanced"
              open={openSections[section.name] ?? false}
              onToggle={(event) => {
                const { open } = event.currentTarget;
                setOpenSections((all) => ({ ...all, [section.name!]: open }));
              }}
            >
              <summary>
                {section.name}
                <SectionBadge
                  invalid={section.options.filter((option) => errors[option.name]).length}
                  changed={changedCount(section.options, current)}
                />
              </summary>
              <div className="options">{section.options.map(renderOption)}</div>
            </details>
          ),
        )}
      </div>
      {raster && (
        <p className="hint" role="status">
          Output: {raster.width} × {raster.height} px
          {raster.limited && ' (reduced to the largest image browsers can render)'}
        </p>
      )}
      {format.perColorHeights && (
        <ColorHeightsTable
          groups={editor.groups}
          heights={colorHeights}
          values={current}
          error={colorHeightsError}
          onChange={(paletteIndex, change) => {
            setColorSettings((all) => ({
              ...all,
              [paletteIndex]: { ...all[paletteIndex], ...change },
            }));
            setPlan(null);
          }}
          onReset={() => {
            setColorSettings((all) =>
              Object.fromEntries(
                Object.entries(all).map(([index, setting]) => [
                  index,
                  { ...setting, height: null },
                ]),
              ),
            );
            setPlan(null);
          }}
        />
      )}
      {job.error && (
        <p className="field-error" role="alert">
          {job.error}
        </p>
      )}
      <div className="actions">
        {canPreview && (
          <button
            type="button"
            className="secondary"
            disabled={invalid}
            onClick={() => setPreview(previewRequest())}
          >
            {preview ? 'Update 3D preview' : 'Preview 3D'}
          </button>
        )}
        <button
          type="button"
          className="secondary"
          disabled={job.exporting || invalid}
          onClick={() =>
            void job.run(render, exportFileName(file?.name, formatExtension(format, current)))
          }
        >
          {job.exporting ? 'Exporting…' : `Export ${format.label}`}
        </button>
      </div>
      {job.exporting && (
        <ExportProgress
          what={`the ${format.label} file`}
          elapsed={job.elapsed}
          onCancel={job.cancel}
        />
      )}
      {format.perColorHeights && (
        <button
          type="button"
          className="link filament-plan__toggle"
          disabled={planning || invalid}
          onClick={() => void showPlan()}
        >
          {planning ? 'Planning…' : plan ? 'Update filament changes' : 'Plan filament changes'}
        </button>
      )}
      {plan && format.perColorHeights && <FilamentPlanView plan={plan} />}
      {preview && canPreview && (
        <Suspense fallback={<p className="hint">Loading 3D viewer…</p>}>
          <ModelPreview request={preview} onCancel={() => setPreview(null)} />
        </Suspense>
      )}
    </details>
  );
}
