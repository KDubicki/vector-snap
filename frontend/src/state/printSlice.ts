import type { StateCreator } from 'zustand';
import { readMyProjects, saveMyProjects, type MyProject } from '../lib/myProjects';
import {
  DEFAULT_PRINT,
  KEPT_BY_PROJECTS,
  PROJECTS,
  applyProject,
  type PrintSettings,
  type ProjectId,
} from '../lib/printPlan';
import { PRINTER_FIELDS, printerOf, readPrinter, savePrinter } from '../lib/printerProfile';
import { fitToPrinter, printerById } from '../lib/printers';
import { browserStorage } from '../lib/theme';
import type { AppState } from './store';

/** 3D print step settings (docs/07-frontend.md#step-4--3d-print-). */
export interface PrintSlice {
  /** Colors and raises reset per SVG. */
  print: PrintSettings;
  /**
   * The print settings before the last project or settings file, which change many at
   * once; gone after the next change, which it would undo too.
   */
  printUndo: { settings: PrintSettings; what: string } | null;
  /** Print settings saved under a name in this browser; kept across images. */
  myProjects: MyProject[];

  setPrint: (change: Partial<PrintSettings>) => void;
  /** Apply a project preset (magnet, keychain, …); colors and raised elements stay. */
  chooseProject: (id: ProjectId) => void;
  /** Apply print settings loaded from a file (lib/printPreset.ts), project included. */
  loadPrintSettings: (settings: Partial<PrintSettings>, what: string) => void;
  /** Restore the settings from before the last project or settings file. */
  undoPrintChange: () => void;
  /** Replace the saved print projects (stored in the browser). */
  setMyProjects: (projects: MyProject[]) => void;
}

/** Print settings that are not part of a project preset. */
const KEPT_SETTINGS = new Set<string>(KEPT_BY_PROJECTS);

/** The settings with a nozzle and layer height the chosen printer has. */
function fitted(print: PrintSettings): PrintSettings {
  return { ...print, ...fitToPrinter(print, printerById(print.printer)) };
}

/** New designs start with the printer remembered in this browser. */
export function startPrint(): PrintSettings {
  return fitted({ ...DEFAULT_PRINT, ...readPrinter(browserStorage()) });
}

export const createPrintSlice: StateCreator<AppState, [], [], PrintSlice> = (set) => ({
  print: startPrint(),
  printUndo: null,
  myProjects: readMyProjects(browserStorage()),

  setPrint: (change) =>
    set((state) => {
      // Editing what a project sets (sizes, base, loop, …) makes the settings custom.
      const custom = Object.keys(change).some((key) => !KEPT_SETTINGS.has(key));
      let print = { ...state.print, ...change, ...(custom && { project: 'custom' as const }) };
      if ('printer' in change || 'nozzleMm' in change) print = fitted(print);
      if (Object.keys(change).some((key) => PRINTER_FIELDS.includes(key))) {
        savePrinter(browserStorage(), printerOf(print));
      }
      return { print, printUndo: null };
    }),
  chooseProject: (id) =>
    set((state) => ({
      print: fitted(applyProject(state.print, id)),
      // Custom changes nothing, so there is nothing to undo.
      printUndo:
        id === 'custom'
          ? null
          : {
              settings: state.print,
              what: PROJECTS.find((project) => project.id === id)?.label ?? id,
            },
    })),
  loadPrintSettings: (settings, what) =>
    set((state) => {
      const print = fitted({ ...state.print, ...settings });
      savePrinter(browserStorage(), printerOf(print));
      return { print, printUndo: { settings: state.print, what } };
    }),
  undoPrintChange: () =>
    set((state) => {
      if (!state.printUndo) return {};
      const print = state.printUndo.settings;
      savePrinter(browserStorage(), printerOf(print));
      return { print, printUndo: null };
    }),
  setMyProjects: (myProjects) => {
    saveMyProjects(browserStorage(), myProjects);
    set({ myProjects });
  },
});
