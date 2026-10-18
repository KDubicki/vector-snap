import { describe, expect, it } from 'vitest';
import { DEFAULT_PRINT } from './printPlan';
import {
  ANY_LAYERS,
  buildProblems,
  fitToPrinter,
  fitWidthMm,
  layerChoices,
  printerById,
  withLayerHeight,
} from './printers';

const kobraX = printerById('kobra-x');

describe('printers', () => {
  it('has the Anycubic Kobra X of Anycubic Slicer Next', () => {
    expect(kobraX).toMatchObject({ buildMm: [260, 260, 260], slots: 4, maxSlots: 19 });
    expect(kobraX.nozzles.map((nozzle) => nozzle.mm)).toEqual([0.25, 0.4, 0.6, 0.8]);
    expect(layerChoices(kobraX, 0.6)).toEqual([0.18, 0.24, 0.3, 0.36, 0.42]);
    expect(layerChoices(kobraX, 0.5)).toEqual(ANY_LAYERS);
    expect(layerChoices(printerById('any'), 0.4)).toEqual(ANY_LAYERS);
    expect(printerById('unknown' as never).id).toBe('any');
  });

  it('fits the nozzle and layer height to the printer, keeping heights in mm', () => {
    const settings = { ...DEFAULT_PRINT, nozzleMm: 0.5, baseLayers: 8, colorLayers: 2 };

    expect(fitToPrinter(settings, kobraX)).toEqual({ nozzleMm: 0.4 });
    // 0.2 mm layers are too thick for the 0.25 nozzle: its default 0.1 mm, same heights.
    expect(fitToPrinter({ ...settings, nozzleMm: 0.25 }, kobraX)).toEqual({
      layerMm: 0.1,
      baseLayers: 16,
      colorLayers: 4,
    });
    expect(fitToPrinter({ ...settings, nozzleMm: 0.6 }, kobraX)).toEqual({});
    expect(fitToPrinter(settings, printerById('any'))).toEqual({});
  });

  it('keeps at least one color layer for a new layer height', () => {
    const settings = { ...DEFAULT_PRINT, layerMm: 0.08, baseLayers: 0, colorLayers: 1 };

    expect(withLayerHeight(settings, 0.4)).toEqual({ layerMm: 0.4, baseLayers: 0, colorLayers: 1 });
  });

  it('names what exceeds the build volume', () => {
    expect(buildProblems({ x_mm: 260, y_mm: 120, z_mm: 3 }, kobraX)).toEqual([]);
    expect(buildProblems({ x_mm: 301.24, y_mm: 120, z_mm: 270 }, kobraX)).toEqual([
      '301.2 mm wide (max 260)',
      '270 mm tall (max 260)',
    ]);
    expect(buildProblems({ x_mm: 900, y_mm: 900, z_mm: 900 }, printerById('any'))).toEqual([]);
  });

  it('fits the width to the bed, keeping border and loop', () => {
    const settings = { ...DEFAULT_PRINT, widthMm: 300, marginMm: 5, loopHoleMm: 4 };
    // 290 mm design + 10 mm border wide; 140 + 10 + 8 (loop) deep.
    const size = { x_mm: 300, y_mm: 158, z_mm: 3 };

    const width = fitWidthMm(settings, size, kobraX)!;
    expect(width).toBe(258); // (260 - 10) / 290 of 300 mm
    // The fitted model: 250 mm design + 10 border = 260 wide.
    expect((width * 290) / 300 + 10).toBeLessThanOrEqual(260);
    expect(fitWidthMm(settings, { x_mm: 200, y_mm: 100, z_mm: 300 }, kobraX)).toBeNull();
    expect(fitWidthMm(settings, size, printerById('any'))).toBeNull();
  });
});
