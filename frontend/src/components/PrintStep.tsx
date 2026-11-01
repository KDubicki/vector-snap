import { useMemo, useState } from 'react';
import { exportFile } from '../api/client';
import { serializeSvg } from '../editor/export';
import { modelTitle } from '../lib/exportFormats';
import {
  filamentsNeeded,
  heightPlan,
  COPY_GAP_MM,
  MAX_COPIES,
  layersToMm,
  mixPlan,
  cutoutChange,
  filamentMatches,
  mixedChange,
  printOptions,
  printedGroups,
  suggestFilaments,
  validatePrint,
  type PrintSettings,
} from '../lib/printPlan';
import { availableFilaments } from '../lib/filamentLibrary';
import { printerById } from '../lib/printers';
import { usePrintCheck } from '../lib/useBackendResult';
import { usePrintStats } from '../lib/usePrintStats';
import { useAppStore } from '../state/store';
import { ApiCommand } from './ApiCommand';
import { BasePlateFields } from './BasePlateFields';
import { BuildVolumeCheck } from './BuildVolumeCheck';
import { ColorChangesSummary } from './ColorChangesSummary';
import { ThinShapesCheck } from './ThinShapesCheck';
import { FilamentSlotsCheck } from './FilamentSlotsCheck';
import { ColorStylePicker } from './ColorStylePicker';
import { FilamentCost } from './FilamentCost';
import { FilamentPlanView } from './FilamentPlanView';
import { FilamentSlots } from './FilamentSlots';
import { MixTable } from './MixTable';
import { MyProjects } from './MyProjects';
import { OutlineFields } from './OutlineFields';
import { LayerFields } from './LayerFields';
import { LayerProfile } from './LayerProfile';
import type { PreviewRequest } from './ModelPreview';
import { PrintColorsTable } from './PrintColorsTable';
import { PrintDownloads } from './PrintDownloads';
import { PrintPreviewPane, type PrintView } from './PrintPreviewPane';
import { PrintSettingsFile } from './PrintSettingsFile';
import { NumberField } from './NumberField';
import { PrintSummary } from './PrintSummary';
import { PrintUndo } from './PrintUndo';
import { PrinterPicker } from './PrinterPicker';
import { PrinterTuningFields } from './PrinterTuningFields';
import { ProjectPicker } from './ProjectPicker';
import { RaisedElementsPanel } from './RaisedElementsPanel';
import { usePrintJobs } from './usePrintJobs';

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
  const [view, setView] = useState<PrintView>('design');
  const [preview, setPreview] = useState<{ request: PreviewRequest; key: string } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

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
  const thin = usePrintCheck(svg ?? '', options, Boolean(svg && !invalid));
  // The 3MF also names the model in the slicer after the image.
  const model = { ...options, title: modelTitle(file?.name) };
  // Previews and plans remember what they were built from, so stale ones are marked.
  const key = JSON.stringify([svg, options]);
  const { job, run, runTiles, runTestCard, plan, showPlan } = usePrintJobs({
    doc: editor,
    settings: print,
    svg: svg ?? '',
    options,
    model,
    printer,
    fileName: file?.name,
    key,
  });

  if (!editor || !svg) return null;

  const heights = heightPlan(editor, print);
  const nearest = filamentMatches(editor, print, availableFilaments(filamentLibrary));
  const mm = (layers: number) => layersToMm(layers, print.layerMm);
  const update = (change: Partial<PrintSettings>) => setPrint(change);
  const showPreview = () => {
    setPreview({
      request: { kind: '3mf', load: (signal) => exportFile('3mf', svg, model, signal) },
      key,
    });
    setView('model');
  };

  return (
    <section className="workspace">
      <PrintPreviewPane
        doc={editor}
        settings={print}
        view={view}
        onView={setView}
        selected={selected}
        onSelect={setSelected}
        mix={mix}
        preview={preview}
        previewKey={key}
        invalid={invalid}
        onShowPreview={showPreview}
        onCancelPreview={() => setPreview(null)}
      />

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

        <LayerProfile
          doc={editor}
          settings={print}
          colors={heights.colors}
          totalLayers={heights.totalLayers}
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

        {(print.style === 'flat' || print.style === 'stepped') && (
          <OutlineFields
            settings={print}
            errors={errors}
            grams={grams}
            slots={slots}
            onChange={update}
          />
        )}

        <PrinterTuningFields settings={print} errors={errors} onChange={update} />

        <NumberField
          id="print-copies"
          label="Copies on the bed"
          value={print.copies}
          min={1}
          max={MAX_COPIES}
          step={1}
          hint={`Printed together in a grid, ${COPY_GAP_MM} mm apart: a batch of magnets or keychains in one go.`}
          error={errors.copies}
          onChange={(copies) => update({ copies })}
        />

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
          <BuildVolumeCheck
            printer={printer}
            settings={print}
            size={size}
            onChange={update}
            onTiles={job.exporting ? undefined : runTiles}
          />
        )}
        {!invalid && (
          <ThinShapesCheck
            check={thin}
            onSelect={(ids) => {
              setSelected(ids);
              setView('design');
            }}
          />
        )}
        {!invalid && <ColorChangesSummary printer={printer} changes={changes} />}
        <PrintSummary
          heightMm={mm(heights.totalLayers)}
          layers={heights.totalLayers}
          baseMm={mm(print.baseLayers)}
          size={invalid ? null : size}
          grams={invalid ? undefined : totalGrams}
        />
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
