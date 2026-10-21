import { Suspense, lazy, useMemo, useState } from 'react';
import { errorMessage, exportFile, getFilamentPlan } from '../api/client';
import { serializeSvg } from '../editor/export';
import { exportFileName, modelTitle } from '../lib/exportFormats';
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
import { usePrintStats } from '../lib/usePrintStats';
import { useAppStore } from '../state/store';
import type { FilamentPlan } from '../types/api';
import { ApiCommand } from './ApiCommand';
import { BasePlateFields } from './BasePlateFields';
import { BuildVolumeCheck } from './BuildVolumeCheck';
import { ColorChangesSummary } from './ColorChangesSummary';
import { FilamentSlotsCheck } from './FilamentSlotsCheck';
import { ColorStylePicker } from './ColorStylePicker';
import { ElementMap } from './ElementMap';
import { FilamentCost } from './FilamentCost';
import { FilamentPlanView } from './FilamentPlanView';
import { FilamentSlots } from './FilamentSlots';
import { MixTable } from './MixTable';
import { MyProjects } from './MyProjects';
import { LayerFields } from './LayerFields';
import type { PreviewRequest } from './ModelPreview';
import { PrintColorsTable } from './PrintColorsTable';
import { PrintDownloads, type PrintFormat } from './PrintDownloads';
import { PrintSettingsFile } from './PrintSettingsFile';
import { PrintUndo } from './PrintUndo';
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
  const printUndo = useAppStore((s) => s.printUndo);
  const myProjects = useAppStore((s) => s.myProjects);
  const {
    setPrint,
    chooseProject,
    loadPrintSettings,
    undoPrintChange,
    setMyProjects,
    goTo,
    setColors,
  } = useAppStore.getState();
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
  // Invalid settings have no size or filament use.
  const { size, changes, grams, slots, totalGrams } = usePrintStats(
    svg ?? '',
    options,
    printer,
    Boolean(svg && !invalid),
  );

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
  // The 3MF also names the model in the slicer after the image.
  const model = { ...options, title: modelTitle(file?.name) };
  // Previews and plans remember what they were built from, so stale ones are marked.
  const key = JSON.stringify([svg, options]);
  const mm = (layers: number) => layersToMm(layers, print.layerMm);
  const update = (change: Partial<PrintSettings>) => setPrint(change);
  const showPreview = () => {
    setPreview({
      request: { kind: '3mf', load: (signal) => exportFile('3mf', svg, model, signal) },
      key,
    });
    setView('model');
  };

  const run = (format: PrintFormat) =>
    job.run(
      (signal) => exportFile(format, svg, format === '3mf' ? model : options, signal),
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
        <MyProjects
          projects={myProjects}
          settings={print}
          onApply={loadPrintSettings}
          onChange={setMyProjects}
        />
        <PrintSettingsFile settings={print} fileName={file?.name} onLoad={loadPrintSettings} />
        <PrintUndo what={printUndo?.what ?? null} onUndo={undoPrintChange} />

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

        <LayerFields
          settings={print}
          errors={errors}
          aspect={editor.width > 0 ? editor.height / editor.width : undefined}
          onChange={update}
        />

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
        {!invalid && <FilamentCost modelGrams={totalGrams} purgeGrams={changes?.purge_g ?? 0} />}
        <PrintDownloads
          invalid={invalid}
          exporting={job.exporting}
          elapsed={job.elapsed}
          error={job.error}
          mixedFilaments={mixed ? print.filaments.length : null}
          onDownload={(format) => void run(format)}
          onCancel={job.cancel}
        />
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
        {!invalid && <ApiCommand options={model} fileName={file?.name} />}
        <button type="button" className="link" onClick={() => goTo('result')}>
          Back to the SVG editor
        </button>
      </aside>
    </section>
  );
}
