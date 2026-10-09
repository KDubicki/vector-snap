import { Suspense, lazy, useMemo, useRef, useState } from 'react';
import { errorMessage, exportFile, getFilamentPlan } from '../api/client';
import { serializeSvg } from '../editor/export';
import { download } from '../lib/download';
import { formatElapsed, useElapsedSeconds } from '../lib/elapsed';
import { exportFileName } from '../lib/exportFormats';
import {
  PROJECTS,
  heightPlan,
  layersToMm,
  printOptions,
  validatePrint,
  type BaseShape,
  type PrintSettings,
} from '../lib/printPlan';
import { useObjectUrl } from '../lib/useObjectUrl';
import { useAppStore } from '../state/store';
import type { FilamentPlan } from '../types/api';
import { FilamentPlanView } from './FilamentPlanView';
import type { PreviewRequest } from './ModelPreview';

// three.js is only downloaded when a 3D preview is opened.
const ModelPreview = lazy(() => import('./ModelPreview'));

const PRINTER_LAYERS = [0.08, 0.12, 0.16, 0.2, 0.24, 0.28];

const BASE_SHAPES: { value: BaseShape; label: string }[] = [
  { value: 'outline', label: 'Follow the design' },
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'rounded', label: 'Rounded rectangle' },
  { value: 'circle', label: 'Circle' },
];

interface NumberFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** Shown after the input, e.g. "= 1.6 mm". */
  suffix?: string;
  hint?: string;
  error?: string;
}

function NumberField({ id, label, suffix, hint, error, onChange, ...input }: NumberFieldProps) {
  return (
    <div className="option">
      <label htmlFor={id}>{label}</label>
      <div className="print-number">
        <input
          id={id}
          type="number"
          {...input}
          value={Number.isFinite(input.value) ? input.value : ''}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => onChange(event.target.valueAsNumber)}
        />
        {suffix && <span className="hint">{suffix}</span>}
      </div>
      {hint && <span className="hint">{hint}</span>}
      {error && (
        <span id={`${id}-error`} className="field-error">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * 3D print step: project presets (magnet, keychain, ornament, sign), flat (AMS) or stepped
 * colors, heights in printer layers, base plate extras, 3D preview and STL/3MF download.
 */
export function PrintStep() {
  const editor = useAppStore((s) => s.editor);
  const file = useAppStore((s) => s.file);
  const print = useAppStore((s) => s.print);
  const { setPrint, chooseProject, goTo } = useAppStore.getState();
  const [view, setView] = useState<'design' | 'model'>('design');
  const [preview, setPreview] = useState<{ request: PreviewRequest; key: string } | null>(null);
  const [status, setStatus] = useState<'idle' | 'exporting'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ plan: FilamentPlan; key: string } | null>(null);
  const exportController = useRef<AbortController | null>(null);
  const elapsed = formatElapsed(useElapsedSeconds(status === 'exporting'));

  const svg = useMemo(() => (editor ? serializeSvg(editor) : null), [editor]);
  const svgBlob = useMemo(() => (svg ? new Blob([svg], { type: 'image/svg+xml' }) : null), [svg]);
  const svgUrl = useObjectUrl(svgBlob);

  if (!editor || !svg) return null;

  const errors = validatePrint(editor, print);
  const invalid = Object.keys(errors).length > 0;
  const heights = heightPlan(editor, print);
  const options = printOptions(editor, print);
  // Previews and plans remember what they were built from, so stale ones are marked.
  const key = JSON.stringify([svg, options]);
  const mm = (layers: number) => layersToMm(layers, print.layerMm);
  const update = (change: Partial<PrintSettings>) => setPrint(change);

  const showPreview = () => {
    setPreview({
      request: { kind: '3mf', load: (signal) => exportFile('3mf', svg, options, signal) },
      key,
    });
    setView('model');
  };

  const run = async (format: 'stl' | '3mf') => {
    const controller = new AbortController();
    exportController.current = controller;
    setStatus('exporting');
    setError(null);
    try {
      const blob = await exportFile(format, svg, options, controller.signal);
      download(blob, exportFileName(file?.name, format));
    } catch (caught) {
      if (!controller.signal.aborted) setError(errorMessage(caught, 'Export failed'));
    } finally {
      exportController.current = null;
      setStatus('idle');
    }
  };

  const showPlan = async () => {
    setError(null);
    try {
      setPlan({ plan: await getFilamentPlan(svg, options), key });
    } catch (caught) {
      setError(errorMessage(caught, 'Planning failed'));
    }
  };

  return (
    <section className="workspace">
      <div className="print-main">
        <div className="segmented result-view" role="radiogroup" aria-label="View">
          {(['design', 'model'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={view === value}
              className={view === value ? 'active' : ''}
              onClick={() => setView(value)}
            >
              {value === 'design' ? 'Design' : '3D preview'}
            </button>
          ))}
        </div>
        {view === 'design' ? (
          <figure className="preview print-design checkerboard">
            {svgUrl && <img className="preview__image" src={svgUrl} alt="Design to print" />}
          </figure>
        ) : preview ? (
          <Suspense fallback={<p className="hint">Loading 3D viewer…</p>}>
            {preview.key !== key && (
              <p className="hint print-stale" role="status">
                Settings changed —{' '}
                <button type="button" className="link" disabled={invalid} onClick={showPreview}>
                  update the preview
                </button>
              </p>
            )}
            <ModelPreview request={preview.request} onCancel={() => setPreview(null)} />
          </Suspense>
        ) : (
          <div className="preview print-empty">
            <p className="hint">The 3D model appears here.</p>
            <button type="button" className="secondary" disabled={invalid} onClick={showPreview}>
              Preview 3D
            </button>
          </div>
        )}
      </div>

      <aside className="panel print-panel">
        <div className="field">
          <span>Project</span>
          <div className="projects" role="radiogroup" aria-label="Project">
            {PROJECTS.map((project) => (
              <button
                key={project.id}
                type="button"
                role="radio"
                aria-checked={print.project === project.id}
                className={`project${print.project === project.id ? ' active' : ''}`}
                onClick={() => chooseProject(project.id)}
              >
                <strong>{project.label}</strong>
                <span>{project.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>Colors</span>
          <div className="segmented" role="radiogroup" aria-label="Color style">
            {(['flat', 'stepped'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={print.style === value}
                className={print.style === value ? 'active' : ''}
                onClick={() => update({ style: value })}
              >
                {value === 'flat' ? 'Flat (AMS)' : 'Stepped'}
              </button>
            ))}
          </div>
          <span className="hint">
            {print.style === 'flat'
              ? 'All colors on the same layers with a level top — for AMS / multi-color printers. Raise colors or elements below to make them stand out.'
              : 'Each color one step higher — for a single extruder: change filament at each step (see the filament plan).'}
          </span>
        </div>

        <div className="options">
          <NumberField
            id="print-width"
            label="Width (mm)"
            value={print.widthMm}
            min={1}
            max={1000}
            step={1}
            error={errors.widthMm}
            onChange={(widthMm) => update({ widthMm })}
          />
          <div className="option">
            <label htmlFor="print-layer">Printer layer height</label>
            <select
              id="print-layer"
              value={print.layerMm}
              onChange={(event) => update({ layerMm: Number(event.target.value) })}
            >
              {PRINTER_LAYERS.map((value) => (
                <option key={value} value={value}>
                  {value} mm
                </option>
              ))}
            </select>
          </div>
          <NumberField
            id="print-base"
            label="Base plate (layers)"
            value={print.baseLayers}
            min={0}
            max={100}
            step={1}
            suffix={`= ${mm(print.baseLayers)} mm`}
            error={errors.baseLayers}
            onChange={(baseLayers) => update({ baseLayers })}
          />
          <NumberField
            id="print-color"
            label={print.style === 'flat' ? 'Colors (layers)' : 'Step per color (layers)'}
            value={print.colorLayers}
            min={1}
            max={50}
            step={1}
            suffix={`= ${mm(print.colorLayers)} mm`}
            error={errors.colorLayers}
            onChange={(colorLayers) => update({ colorLayers })}
          />
        </div>

        <fieldset className="color-heights print-colors">
          <legend>Height per color</legend>
          <ul>
            {editor.groups
              .filter((group) => group.shapes.length > 0)
              .map((group) => {
                const included = !print.excluded.includes(group.paletteIndex);
                const layers = heights.colors.get(group.paletteIndex);
                const id = `print-raise-${group.paletteIndex}`;
                return (
                  <li key={group.paletteIndex}>
                    <input
                      type="checkbox"
                      checked={included}
                      aria-label={`Print ${group.fill}`}
                      onChange={() =>
                        update({
                          excluded: included
                            ? [...print.excluded, group.paletteIndex]
                            : print.excluded.filter((index) => index !== group.paletteIndex),
                        })
                      }
                    />
                    <span className="swatch" style={{ background: group.fill }} />
                    <label htmlFor={id}>{group.fill}</label>
                    <input
                      id={id}
                      type="number"
                      min={0}
                      max={50}
                      step={1}
                      disabled={!included}
                      aria-label={`Extra layers for ${group.fill}`}
                      value={print.colorRaise[group.paletteIndex] ?? 0}
                      onChange={(event) =>
                        update({
                          colorRaise: {
                            ...print.colorRaise,
                            [group.paletteIndex]: Math.max(0, event.target.valueAsNumber || 0),
                          },
                        })
                      }
                    />
                    <span className="hint">
                      {layers === undefined ? 'left out' : `${mm(layers)} mm`}
                    </span>
                  </li>
                );
              })}
          </ul>
          <span className="hint">Extra layers raise a whole color above the others.</span>
          {errors.colors && <span className="field-error">{errors.colors}</span>}
        </fieldset>

        <div className="field">
          <span>Base plate</span>
          <div className="options">
            <div className="option">
              <label htmlFor="print-shape">Shape</label>
              <select
                id="print-shape"
                value={print.baseShape}
                onChange={(event) => update({ baseShape: event.target.value as BaseShape })}
              >
                {BASE_SHAPES.map((shape) => (
                  <option key={shape.value} value={shape.value}>
                    {shape.label}
                  </option>
                ))}
              </select>
            </div>
            <NumberField
              id="print-margin"
              label="Border around the design (mm)"
              value={print.marginMm}
              min={0}
              max={100}
              step={0.5}
              onChange={(marginMm) => update({ marginMm })}
            />
            <NumberField
              id="print-loop"
              label="Hanging loop hole (mm)"
              value={print.loopHoleMm}
              min={0}
              max={20}
              step={0.5}
              hint="For a key ring, ribbon or hook. 0 = no loop."
              error={errors.loopHoleMm}
              onChange={(loopHoleMm) => update({ loopHoleMm })}
            />
            <NumberField
              id="print-magnet"
              label="Magnet pocket diameter (mm)"
              value={print.magnetMm}
              min={0}
              max={50}
              step={0.1}
              hint="Pocket in the back, ~0.2 mm wider than the magnet. 0 = none."
              onChange={(magnetMm) => update({ magnetMm })}
            />
            {print.magnetMm > 0 && (
              <NumberField
                id="print-magnet-depth"
                label="Magnet pocket depth (mm)"
                value={print.magnetDepthMm}
                min={0.1}
                max={20}
                step={0.1}
                error={errors.magnetDepthMm}
                onChange={(magnetDepthMm) => update({ magnetDepthMm })}
              />
            )}
            <NumberField
              id="print-nozzle"
              label="Drop details thinner than (mm)"
              value={print.nozzleMm}
              min={0}
              max={10}
              step={0.1}
              hint="Your nozzle width; thinner lines and specks cannot be printed."
              onChange={(nozzleMm) => update({ nozzleMm })}
            />
          </div>
        </div>

        <p className="print-summary" role="status">
          Total height <strong>{mm(heights.totalLayers)} mm</strong> · {heights.totalLayers} layers
          · base {mm(print.baseLayers)} mm
        </p>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={invalid || status !== 'idle'}
            onClick={() => void run('3mf')}
          >
            Download 3MF
          </button>
          <button
            type="button"
            className="secondary"
            disabled={invalid || status !== 'idle'}
            onClick={() => void run('stl')}
          >
            Download STL
          </button>
        </div>
        <span className="hint">
          3MF keeps one part per color, so the slicer assigns AMS slots automatically.
        </span>
        {status === 'exporting' && (
          <p className="hint export__progress" role="status">
            <span className="spinner" aria-hidden="true" />
            Building the model{elapsed && ` · ${elapsed}`}
            <button
              type="button"
              className="link"
              onClick={() => exportController.current?.abort()}
            >
              Cancel
            </button>
          </p>
        )}
        <div className="actions">
          <button type="button" className="secondary" disabled={invalid} onClick={showPreview}>
            {preview ? 'Update 3D preview' : 'Preview 3D'}
          </button>
          {print.style === 'stepped' && (
            <button
              type="button"
              className="secondary"
              disabled={invalid}
              onClick={() => void showPlan()}
            >
              Filament changes
            </button>
          )}
        </div>
        {plan && print.style === 'stepped' && plan.key === key && (
          <FilamentPlanView plan={plan.plan} />
        )}
        <button type="button" className="link" onClick={() => goTo('result')}>
          Back to the SVG editor
        </button>
      </aside>
    </section>
  );
}
