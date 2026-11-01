import { useState } from 'react';
import { errorMessage, exportFile, getFilamentPlan } from '../api/client';
import type { EditorDoc } from '../editor/model';
import { serializeSvg } from '../editor/export';
import { exportFileName } from '../lib/exportFormats';
import { printOptions, testCard, type PrintSettings } from '../lib/printPlan';
import type { Printer } from '../lib/printers';
import { useExport, type ExportJob } from '../lib/useExport';
import type { FilamentPlan } from '../types/api';
import type { PrintFormat } from './PrintDownloads';

type FormOptions = Record<string, string | number | boolean>;

interface PrintJobs {
  job: ExportJob;
  /** Download the model as 3MF, STL or STL parts. */
  run: (format: PrintFormat) => Promise<void>;
  /** The model cut into tiles of the printer's bed, for models larger than it. */
  runTiles: () => void;
  /** A small print of every mixed color, to check the predictions with real filaments. */
  runTestCard: () => void;
  /** The filament changes of a stepped print and the settings (`key`) they were planned for. */
  plan: { plan: FilamentPlan; key: string } | null;
  showPlan: () => Promise<void>;
}

/**
 * Downloads and backend plans of the 3D print step. `options` are the STL form fields,
 * `model` the 3MF ones (with the model's title), `key` identifies the settings, so a plan
 * made for others can be told apart.
 */
export function usePrintJobs({
  doc,
  settings,
  svg,
  options,
  model,
  printer,
  fileName,
  key,
}: {
  doc: EditorDoc | null;
  settings: PrintSettings;
  svg: string;
  options: FormOptions;
  model: FormOptions;
  printer: Printer;
  fileName: string | undefined;
  key: string;
}): PrintJobs {
  const job = useExport();
  const [plan, setPlan] = useState<{ plan: FilamentPlan; key: string } | null>(null);

  const run = (format: PrintFormat) =>
    job.run(
      (signal) => exportFile(format, svg, format === '3mf' ? model : options, signal),
      exportFileName(fileName, format === 'stl-parts' ? 'parts.zip' : format),
    );

  const runTiles = () => {
    const [x, y] = printer.buildMm ?? [0, 0];
    void job.run(
      (signal) => exportFile('tiles', svg, { ...model, tile_x_mm: x, tile_y_mm: y }, signal),
      exportFileName(fileName, 'tiles.zip'),
    );
  };

  const runTestCard = () => {
    if (!doc) return;
    const card = testCard(doc, settings);
    const cardSvg = serializeSvg(card.doc);
    const cardOptions = printOptions(card.doc, card.settings);
    void job.run(
      (signal) => exportFile('3mf', cardSvg, cardOptions, signal),
      exportFileName(fileName, 'test-card.3mf'),
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

  return { job, run, runTiles, runTestCard, plan, showPlan };
}
