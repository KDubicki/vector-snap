import { Suspense, lazy, useMemo, useState } from 'react';
import { errorMessage, exportFile, getFilamentPlan } from '../api/client';
import { serializeSvg } from '../editor/export';
import { exportFileName } from '../lib/exportFormats';
import {
  filamentsNeeded,
  heightPlan,
  nextSelection,
  layersToMm,
  mixPlan,
  cutoutChange,
  mixedChange,
  printOptions,
  printedGroups,
  suggestFilaments,
  testCard,
  validatePrint,
  type PrintSettings,
} from '../lib/printPlan';
import { availableFilaments } from '../lib/filamentLibrary';
import { formatGrams, formatMillimetres } from '../lib/meshStats';
import { nearestFilaments } from '../lib/paletteAdvice';
import { printerById } from '../lib/printers';
import { useExport } from '../lib/useExport';
import { useColorChanges, useModelSize } from '../lib/useBackendResult';
import { useAppStore } from '../state/store';
import type { FilamentPlan } from '../types/api';
import { BasePlateFields } from './BasePlateFields';
import { BuildVolumeCheck } from './BuildVolumeCheck';
import { ColorChangesSummary } from './ColorChangesSummary';
import { FilamentSlotsCheck } from './FilamentSlotsCheck';
import { ColorStylePicker } from './ColorStylePicker';
import { ElementMap } from './ElementMap';
import { ExportProgress } from './ExportProgress';
import { FilamentPlanView } from './FilamentPlanView';
import { FilamentSlots } from './FilamentSlots';
import { MixTable } from './MixTable';
import { LayerFields } from './LayerFields';
import type { PreviewRequest } from './ModelPreview';
import { PrintColorsTable } from './PrintColorsTable';
import { PrintSettingsFile } from './PrintSettingsFile';
import { PrinterPicker } from './PrinterPicker';
import { PrinterTuningFields } from './PrinterTuningFields';
import { ProjectPicker } from './ProjectPicker';
import { RaisedElementsPanel } from './RaisedElementsPanel';

// three.js is only downloaded when a 3D preview is opened.
const ModelPreview = lazy(() => import('./ModelPreview'));

/**
 * 3D print step: project presets (magnet, keychain, ornament, sign), flat (AMS) or stepped
 * colors, heights in printer layers, base plate extras, printer tuning, 3D preview and
 * STL/3MF download.
 */
export function PrintStep() {
  const editor = useAppStore((s) => s.editor);
  const file = useAppStore((s) => s.file);
  const print = useAppStore((s) => s.print);
  const limits = useAppStore((s) => s.limits);
  const filamentLibrary = useAppStore((s) => s.filamentLibrary);
  const { setPrint, chooseProject, loadPrintSettings, goTo, setColors } = useAppStore.getState();
  const [view, setView] = useState<'design' | 'model'>('design');
  const [preview, setPreview] = useState<{ request: PreviewRequest; key: string } | null>(null);
  const job = useExport();
  const [plan, setPlan] = useState<{ plan: FilamentPlan; key: string } | null>(null);

  const [selected, setSelected] = useState<string[]>([]);

  const [showPredicted, setShowPredicted] = useState(true);

  const svg = useMemo(() => (editor ? serializeSvg(editor) : null), [editor]);
  const mixed = print.style === 'mixed';
  const mix = useMemo(
    () => (editor && mixed ? mixPlan(editor, print) : new Map()),
    [editor, mixed, print],
  );
  const printer = printerById(print.printer);
  const errors = editor ? validatePrint(editor, print) : {};
  const invalid = Object.keys(errors).length > 0;
  const options = editor ? printOptions(editor, print) : {};
  // The size of the model as exported (border, round plate and loop included); invalid
  // settings have none.
  const size = useModelSize(svg ?? '', options, Boolean(svg && !invalid));
  const changes = useColorChanges(
    svg ?? '',
    { ...options, change_s: printer.changeS, purge_mm3: printer.purgeMm3 },
    // Asked for every printer: it also gives the filament each color takes.
    Boolean(svg && !invalid),
  );
  const grams = new Map(changes?.filaments.map((use) => [use.color, use.grams]));
  // The 3MF numbers its filaments in this order (base plate's color first): the slots.
  const slots = new Map(changes?.filaments.map((use, index) => [use.color, index + 1]));
  const totalGrams = changes?.filaments.reduce((sum, use) => sum + use.grams, 0);

  if (!editor || !svg) return null;

  const heights = heightPlan(editor, print);
  // Mixed colors have their own recipes; cut-out colors are holes, not filament.
  const nearest =
    print.style === 'flat' || print.style === 'stepped'
      ? nearestFilaments(
          editor.groups.map((group) => ({
            index: group.paletteIndex,
            hex: group.fill,
            coverage: 0,
          })),
          availableFilaments(filamentLibrary),
        )
      : undefined;
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

  const run = (format: 'stl' | '3mf' | 'stl-parts') =>
    job.run(
      (signal) => exportFile(format, svg, options, signal),
      exportFileName(file?.name, format === 'stl-parts' ? 'parts.zip' : format),
    );

  /** A small print of every mixed color, to check the predictions with real filaments. */
  const runTestCard = () => {
    const card = testCard(editor, print);
    const cardSvg = serializeSvg(card.doc);
    const cardOptions = printOptions(card.doc, card.settings);
    void job.run(
      (signal) => exportFile('3mf', cardSvg, cardOptions, signal),
      exportFileName(file?.name, 'test-card.3mf'),
    );
  };

  const showPlan = async () => {
    job.setError(null);
    try {
      setPlan({ plan: await getFilamentPlan(svg, options), key });
    } catch (caught) {
      job.setError(errorMessage(caught, 'Planning failed'));
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
          <figure
            className={`preview print-design${print.mirror ? ' print-design--mirrored' : ''}`}
          >
            <ElementMap
              doc={editor}
              selected={selected}
              raised={print.shapeRaise}
              excluded={print.excluded}
              fills={
                mixed && showPredicted
                  ? new Map([...mix].map(([index, match]) => [index, match.predicted]))
                  : undefined
              }
              onSelect={(id, additive) => setSelected(nextSelection(selected, id, additive))}
            />
            <figcaption className="hint">
              Click an element to select it, Shift+click to add more — then raise it in the panel.
              Dashed outlines mark raised elements.
              {print.mirror && ' Shown mirrored, as it will print.'}
              {mixed && (
                <label className="print-predicted">
                  <input
                    type="checkbox"
                    checked={showPredicted}
                    onChange={(event) => setShowPredicted(event.target.checked)}
                  />
                  Show predicted print colors
                </label>
              )}
            </figcaption>
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
        <PrinterPicker settings={print} onChange={update} />

        <ProjectPicker project={print.project} onChoose={chooseProject} />
        <PrintSettingsFile settings={print} fileName={file?.name} onLoad={loadPrintSettings} />

        <ColorStylePicker
          style={print.style}
          onChoose={(value) =>
            update(
              value === 'mixed'
                ? mixedChange(editor, print)
                : value === 'cutout'
                  ? cutoutChange(editor, print)
                  : { style: value },
            )
          }
        />

        {mixed && (
          <FilamentSlots
            filaments={print.filaments}
            error={errors.filaments}
            onChange={(filaments) => update({ filaments })}
            onSuggest={() => update({ filaments: suggestFilaments(editor) })}
          />
        )}

        <LayerFields settings={print} errors={errors} onChange={update} />

        <PrintColorsTable
          doc={editor}
          settings={print}
          colors={heights.colors}
          nearest={nearest}
          grams={mixed ? undefined : grams}
          slots={mixed || print.style === 'cutout' ? undefined : slots}
          error={errors.colors}
          onChange={update}
        />

        {mixed && !errors.filaments && (
          <MixTable
            groups={printedGroups(editor, print)}
            plan={mix}
            filaments={print.filaments}
            busy={invalid || job.exporting}
            onTestCard={runTestCard}
          />
        )}

        <RaisedElementsPanel
          doc={editor}
          settings={print}
          selected={selected}
          onClearSelection={() => setSelected([])}
          onChange={update}
        />

        <BasePlateFields settings={print} errors={errors} onChange={update} />

        <PrinterTuningFields settings={print} errors={errors} onChange={update} />

        <FilamentSlotsCheck
          printer={printer}
          needed={filamentsNeeded(editor, print)}
          loaded={print.filamentSlots}
          minColors={limits.min_colors}
          onReduce={(colors) => {
            setColors(colors);
            goTo('palette');
          }}
        />
        {!invalid && (
          <BuildVolumeCheck printer={printer} settings={print} size={size} onChange={update} />
        )}
        {!invalid && <ColorChangesSummary printer={printer} changes={changes} />}
        <p className="print-summary" role="status">
          Total height <strong>{mm(heights.totalLayers)} mm</strong> · {heights.totalLayers} layers
          · base {mm(print.baseLayers)} mm
          {!invalid && size && (
            <>
              {' '}
              · {formatMillimetres(size.x_mm)} × {formatMillimetres(size.y_mm)} mm footprint
            </>
          )}
          {!invalid && totalGrams !== undefined && (
            <> · {formatGrams(totalGrams)} g of filament (solid)</>
          )}
        </p>
        {job.error && (
          <p className="field-error" role="alert">
            {job.error}
          </p>
        )}
        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={invalid || job.exporting}
            onClick={() => void run('3mf')}
          >
            Download 3MF
          </button>
          <button
            type="button"
            className="secondary"
            disabled={invalid || job.exporting}
            onClick={() => void run('stl')}
          >
            Download STL
          </button>
        </div>
        <button
          type="button"
          className="link"
          disabled={invalid || job.exporting}
          onClick={() => void run('stl-parts')}
        >
          STL per color (ZIP)
        </button>
        <span className="hint">
          {mixed
            ? `3MF parts come only in the ${print.filaments.length} filament colors: assign each to the AMS slot with that filament.`
            : '3MF keeps one part per color, so the slicer assigns AMS slots automatically. Slicers without 3MF colors: load the ZIP’s STL files together as one multi-part object.'}
        </span>
        {job.exporting && (
          <ExportProgress what="the model" elapsed={job.elapsed} onCancel={job.cancel} />
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
