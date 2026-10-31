/** Project presets (fridge magnet, keychain, ornament, sign, coaster) and the defaults. */

import type { PrintSettings, ProjectId } from './settings';

/** Settings that belong to the design or the printer, so projects keep them. */
export const KEPT_BY_PROJECTS = [
  'style',
  'cutThrough',
  'mirror',
  'colorRaise',
  'excluded',
  'shapeRaise',
  'filaments',
  'printer',
  'filamentSlots',
  'nozzleMm',
  'elephantFootMm',
  'simplifyMm',
  'colorGapMm',
  'copies',
] as const;

/** Settings a project applies. */
type ProjectSettings = Omit<PrintSettings, 'project' | (typeof KEPT_BY_PROJECTS)[number]>;

const COMMON: ProjectSettings = {
  layerMm: 0.2,
  widthMm: 80,
  baseLayers: 8,
  colorLayers: 2,
  baseShape: 'outline',
  marginMm: 0,
  rimMm: 0,
  loopHoleMm: 0,
  loopPosition: 'top',
  magnetMm: 0,
  magnetDepthMm: 2,
  magnetCount: 1,
  screwHoles: 0,
  screwHoleMm: 4,
  outlineMm: 0,
  outlineColor: '#000000',
  outlineRaised: false,
  inlay: false,
};

export interface Project {
  id: ProjectId;
  label: string;
  description: string;
  settings: ProjectSettings;
}

export const PROJECTS: Project[] = [
  {
    id: 'magnet',
    label: 'Fridge magnet',
    description: '60 mm, 2.4 mm base with a pocket for a 10 × 2 mm magnet.',
    settings: { ...COMMON, widthMm: 60, baseLayers: 12, marginMm: 2, magnetMm: 10.2 },
  },
  {
    id: 'keychain',
    label: 'Keychain',
    description: '45 mm, 2 mm base, border and a loop for the key ring.',
    settings: { ...COMMON, widthMm: 45, baseLayers: 10, marginMm: 2, loopHoleMm: 4 },
  },
  {
    id: 'ornament',
    label: 'Christmas ornament',
    description: 'Flat 80 mm bauble on a round plate with a hanging loop.',
    settings: { ...COMMON, baseShape: 'circle', marginMm: 2, loopHoleMm: 3 },
  },
  {
    id: 'sign',
    label: 'Sign or coaster',
    description: '100 mm on a rounded rectangle with a 5 mm border.',
    settings: { ...COMMON, widthMm: 100, baseLayers: 10, baseShape: 'rounded', marginMm: 5 },
  },
  {
    id: 'coaster',
    label: 'Flat coaster',
    description: '100 mm round coaster, colors set flush into a 3 mm base — a flat top for AMS.',
    settings: {
      ...COMMON,
      widthMm: 100,
      baseLayers: 15,
      baseShape: 'circle',
      marginMm: 4,
      inlay: true,
    },
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Keeps the current settings: set everything yourself.',
    settings: COMMON,
  },
];

export const DEFAULT_PRINT: PrintSettings = {
  project: 'custom',
  printer: 'any',
  filamentSlots: 4,
  style: 'flat',
  ...COMMON,
  colorRaise: {},
  excluded: [],
  shapeRaise: {},
  filaments: [],
  cutThrough: false,
  mirror: false,
  nozzleMm: 0.4,
  elephantFootMm: 0,
  simplifyMm: 0,
  colorGapMm: 0,
  copies: 1,
};

/** Apply a project's settings; colors, style and filaments stay. Custom changes nothing. */
export function applyProject(settings: PrintSettings, id: ProjectId): PrintSettings {
  const project = PROJECTS.find((item) => item.id === id);
  if (!project || id === 'custom') return { ...settings, project: 'custom' };
  return { ...settings, ...project.settings, project: id };
}
