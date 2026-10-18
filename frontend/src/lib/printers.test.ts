import { describe, expect, it } from 'vitest';
import { DEFAULT_PRINT } from './printPlan';
import { ANY_LAYERS, fitToPrinter, layerChoices, printerById, withLayerHeight } from './printers';

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
});
