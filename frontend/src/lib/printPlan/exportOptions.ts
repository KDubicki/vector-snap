/** Whether a print can be exported, and the STL/3MF form options sent for it. */

import type { EditorDoc } from '../../editor/model';
import { isHexColor } from '../color';
import { MAGNET_ROOF_MM } from '../exportFormats';
import { colorStacks } from '../mixing';
import { nozzleOf, printerById } from '../printers';
import { mixPlan } from './colorStyles';
import { heightPlan, outlined, printedGroups } from './heights';
import { layersToMm, MAX_COPIES, type PrintSettings } from './settings';

/** Problems that would make the export fail, by settings field. */
export function validatePrint(doc: EditorDoc, settings: PrintSettings): Record<string, string> {
  const errors: Record<string, string> = {};
  const base = layersToMm(settings.baseLayers, settings.layerMm);
  if (settings.style === 'mixed') {
    const bad = settings.filaments.some(
      (filament) => !isHexColor(filament.color) || !(filament.td > 0 && filament.td <= 100),
    );
    if (!settings.filaments.length) errors.filaments = 'Add at least one filament.';
    else if (bad) errors.filaments = 'Every filament needs a color and a TD above 0 mm.';
  }
  if (!(settings.widthMm >= 1 && settings.widthMm <= 1000)) {
    errors.widthMm = 'Must be between 1 and 1000 mm.';
  }
  if (!(settings.colorLayers >= 1)) errors.colorLayers = 'At least 1 layer.';
  if (!(settings.baseLayers >= 0)) errors.baseLayers = 'Cannot be negative.';
  if (settings.loopHoleMm > 0 && base <= 0) errors.loopHoleMm = 'A hanging loop needs a base.';
  const magnets = settings.magnetCount;
  if (!Number.isInteger(magnets) || magnets < 1 || magnets > 4) {
    errors.magnetCount = 'Between 1 and 4 magnets.';
  }
  if (![0, 2, 4].includes(settings.screwHoles)) errors.screwHoles = 'None, 2 or 4 holes.';
  else if (settings.screwHoles > 0 && base <= 0) errors.screwHoles = 'Screw holes need a base.';
  if (settings.screwHoles > 0 && !(settings.screwHoleMm > 0 && settings.screwHoleMm <= 10)) {
    errors.screwHoleMm = 'Between 0.1 and 10 mm.';
  }
  if (outlined(settings)) {
    if (settings.outlineMm > 5) errors.outlineMm = 'At most 5 mm.';
    else if (settings.inlay) errors.outlineMm = 'Outlines stand on the plate: untick the flat top.';
    if (!isHexColor(settings.outlineColor)) errors.outlineColor = 'Choose a color.';
  }
  if (settings.rimMm > 0 && base <= 0) errors.rimMm = 'A rim needs a base.';
  if (!Number.isInteger(settings.copies) || settings.copies < 1 || settings.copies > MAX_COPIES) {
    errors.copies = `Between 1 and ${MAX_COPIES} copies.`;
  }
  if (settings.elephantFootMm > 0 && base <= 0) {
    errors.elephantFootMm = "Elephant's foot compensation needs a base.";
  }
  const cutout = settings.style === 'cutout';
  const sunk = cutout || settings.inlay;
  // Inlaid colors take the top of the base plate: it must be thicker than the tallest.
  const inlaid = sunk ? Math.min(heightPlan(doc, settings).top, settings.baseLayers) : 0;
  if (cutout && settings.baseLayers <= 0) {
    errors.baseLayers = 'Cutting out needs a base plate to cut into.';
  } else if (cutout && heightPlan(doc, settings).top > settings.baseLayers) {
    errors.colorLayers = `Deeper than the base plate (${settings.baseLayers} layers): tick "Cut through" for holes.`;
  }
  const needed = (layers: number) =>
    `Needs a base of at least ${layers} layers (${layersToMm(layers, settings.layerMm)} mm).`;
  if (!cutout && settings.inlay && settings.baseLayers <= inlaid) {
    errors.inlay = needed(inlaid + 1);
  }
  const solid = layersToMm(settings.baseLayers - inlaid, settings.layerMm);
  if (settings.magnetMm > 0 && settings.magnetDepthMm > solid - MAGNET_ROOF_MM + 1e-9) {
    const layers = Math.ceil((settings.magnetDepthMm + MAGNET_ROOF_MM) / settings.layerMm - 1e-9);
    errors.magnetDepthMm = needed(layers + inlaid);
  }
  const printer = printerById(settings.printer);
  const nozzle = nozzleOf(printer, settings.nozzleMm);
  if (nozzle && (settings.layerMm < nozzle.minLayerMm || settings.layerMm > nozzle.maxLayerMm)) {
    errors.layerMm = `The ${printer.label} prints ${nozzle.mm} mm nozzle layers of ${nozzle.minLayerMm}–${nozzle.maxLayerMm} mm.`;
  }
  if (printedGroups(doc, settings).length === 0) errors.colors = 'Include at least one color.';
  return errors;
}

/** STL/3MF form options for the backend (docs/13-export-formats.md). */
export function printOptions(
  doc: EditorDoc,
  settings: PrintSettings,
): Record<string, string | number | boolean> {
  const { colors, shapes, top } = heightPlan(doc, settings);
  const mm = (layers: number) => layersToMm(layers, settings.layerMm);
  const layerHeights: Record<string, number> = {};
  for (const group of doc.groups) {
    layerHeights[group.paletteIndex] = mm(colors.get(group.paletteIndex) ?? 0);
  }
  const shapeHeights = Object.fromEntries([...shapes].map(([id, layers]) => [id, mm(layers)]));
  const mixed: Record<string, string> =
    settings.style === 'mixed'
      ? {
          filaments: JSON.stringify(settings.filaments.map((filament) => filament.color)),
          color_stacks: JSON.stringify(
            colorStacks(
              new Map([...mixPlan(doc, settings)].map(([index, match]) => [index, match.recipe])),
              settings.layerMm,
            ),
          ),
        }
      : {};
  return {
    width_mm: settings.widthMm,
    base_mm: mm(settings.baseLayers),
    layer_mm: mm(settings.colorLayers),
    layered: settings.style === 'stepped',
    layer_heights: JSON.stringify(layerHeights),
    shape_heights: JSON.stringify(shapeHeights),
    print_layer_mm: settings.layerMm,
    min_feature_mm: settings.nozzleMm,
    base_shape: settings.baseShape,
    base_margin_mm: settings.marginMm,
    stack_order: 'document',
    rim_mm: settings.rimMm,
    rim_height_mm: 0,
    loop_hole_mm: settings.loopHoleMm,
    loop_position: settings.loopPosition,
    magnet_mm: settings.magnetMm,
    magnet_depth_mm: settings.magnetDepthMm,
    magnet_count: settings.magnetCount,
    screw_holes: settings.screwHoles,
    screw_hole_mm: settings.screwHoleMm,
    outline_mm: outlined(settings) ? settings.outlineMm : 0,
    outline_color: settings.outlineColor.toLowerCase(),
    outline_height_mm: settings.outlineRaised ? mm(top + 1) : 0,
    relief: settings.style === 'cutout' ? 'engrave' : settings.inlay ? 'inlay' : 'raised',
    elephant_foot_mm: settings.elephantFootMm,
    simplify_mm: settings.simplifyMm,
    color_gap_mm: settings.colorGapMm,
    mirror: settings.mirror,
    copies: settings.copies,
    ...mixed,
  };
}
