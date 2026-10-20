/**
 * My projects: print settings saved under a name in this browser, applied to any design
 * like the built-in projects. Each is kept as a print settings file (lib/printPreset.ts),
 * so the colors' per-design choices stay out and reading it back checks every field.
 * See docs/07-frontend.md.
 */

import type { PrintSettings } from './printPlan';
import { presetJson, readPreset } from './printPreset';

export const MY_PROJECTS_KEY = 'vectorsnap.my-projects';
/** Longest name and most projects kept (the oldest goes). */
export const MAX_PROJECT_NAME = 40;
export const MAX_MY_PROJECTS = 12;

export interface MyProject {
  name: string;
  /** The settings as a print settings file (JSON). */
  preset: string;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The saved project with this name (any case), if there is one. */
export function findMyProject(projects: MyProject[], name: string): MyProject | undefined {
  return projects.find((project) => sameName(project.name, name));
}

/** Save the settings under `name`, newest first; a project of the same name is replaced. */
export function saveAsMyProject(
  projects: MyProject[],
  name: string,
  settings: PrintSettings,
): MyProject[] {
  const project = { name: name.trim().slice(0, MAX_PROJECT_NAME), preset: presetJson(settings) };
  const others = projects.filter((item) => !sameName(item.name, project.name));
  return [project, ...others].slice(0, MAX_MY_PROJECTS);
}

export function removeMyProject(projects: MyProject[], name: string): MyProject[] {
  return projects.filter((project) => project.name !== name);
}

/**
 * The settings a saved project applies. It is marked custom: its sizes need not match the
 * built-in project it started from.
 */
export function myProjectSettings(project: MyProject): Partial<PrintSettings> {
  return { ...readPreset(project.preset), project: 'custom' };
}

function readable(item: Partial<MyProject> | null): item is MyProject {
  if (typeof item?.name !== 'string' || !item.name.trim() || typeof item.preset !== 'string') {
    return false;
  }
  try {
    readPreset(item.preset);
    return true;
  } catch {
    return false;
  }
}

/** The projects in storage; unreadable ones (e.g. from a newer version) are left out. */
export function readMyProjects(storage: Pick<Storage, 'getItem'> | undefined): MyProject[] {
  try {
    const raw = storage?.getItem(MY_PROJECTS_KEY);
    const data: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(data)) return [];
    return (data as (Partial<MyProject> | null)[])
      .filter(readable)
      .map(({ name, preset }) => ({ name, preset }))
      .slice(0, MAX_MY_PROJECTS);
  } catch {
    return [];
  }
}

export function saveMyProjects(
  storage: Pick<Storage, 'setItem'> | undefined,
  projects: MyProject[],
): void {
  try {
    storage?.setItem(MY_PROJECTS_KEY, JSON.stringify(projects));
  } catch {
    // Not remembered; the projects still apply to this page.
  }
}
