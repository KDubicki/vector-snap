import { describe, expect, it } from 'vitest';
import {
  EXPORT_FORMATS,
  autoLayerHeight,
  defaultValues,
  exportFileName,
  layerHeightsJson,
  validate,
  validateColorHeights,
} from './exportFormats';

const stl = EXPORT_FORMATS.find((format) => format.id === 'stl')!;

describe('export formats', () => {
  it('provides defaults for every option', () => {
    expect(defaultValues(stl)).toEqual({
      width_mm: 100,
      base_mm: 1,
      layer_mm: 1,
      layered: true,
      mirror: false,
    });
  });

  it('validates ranges and types', () => {
    expect(validate(stl, defaultValues(stl))).toEqual({});
    expect(
      validate(stl, {
        width_mm: 0,
        base_mm: Number.NaN,
        layer_mm: 1,
        layered: 'yes' as never,
        mirror: false,
      }),
    ).toEqual({
      width_mm: 'Must be between 1 and 10000.',
      base_mm: 'Enter a number.',
      layered: 'Invalid value.',
    });
  });

  it('offers 3MF with the same model options and per-color heights as STL', () => {
    const threeMf = EXPORT_FORMATS.find((format) => format.id === '3mf')!;

    expect(threeMf.extension).toBe('3mf');
    expect(threeMf.options).toBe(stl.options);
    expect(threeMf.perColorHeights).toBe(true);
  });

  it('offers DXF with width and fill options', () => {
    const dxf = EXPORT_FORMATS.find((format) => format.id === 'dxf')!;

    expect(dxf.extension).toBe('dxf');
    expect(defaultValues(dxf)).toEqual({ width_mm: 100, fill: false });
  });

  it('offers PDF with a validated page choice', () => {
    const pdf = EXPORT_FORMATS.find((format) => format.id === 'pdf')!;

    expect(defaultValues(pdf)).toEqual({ page: 'fit', width_mm: 100, margin_mm: 10 });
    expect(validate(pdf, { ...defaultValues(pdf), page: 'a3' })).toEqual({
      page: 'Choose one of the options.',
    });
  });

  it('builds file names from the source file', () => {
    expect(exportFileName('logo.final.png', 'stl')).toBe('logo.final.stl');
    expect(exportFileName(undefined, 'dxf')).toBe('vectorsnap.dxf');
  });
});

describe('per-color heights', () => {
  it('computes automatic heights like the backend', () => {
    expect(autoLayerHeight(2, { layer_mm: 0.5, layered: true })).toBe(1.5);
    expect(autoLayerHeight(2, { layer_mm: 0.5, layered: false })).toBe(0.5);
  });

  it('sends only excluded colors and explicit heights', () => {
    const json = layerHeightsJson([
      { paletteIndex: 0, included: false, height: null },
      { paletteIndex: 1, included: true, height: null },
      { paletteIndex: 3, included: true, height: 2.5 },
      { paletteIndex: 4, included: false, height: 7 },
    ]);

    expect(JSON.parse(json)).toEqual({ '0': 0, '3': 2.5, '4': 0 });
  });

  it('validates the selection and the height range', () => {
    expect(validateColorHeights([])).toBeNull();
    expect(validateColorHeights([{ paletteIndex: 0, included: false, height: null }])).toBe(
      'Include at least one color.',
    );
    expect(validateColorHeights([{ paletteIndex: 0, included: true, height: 0 }])).toMatch(
      'greater than 0',
    );
    expect(validateColorHeights([{ paletteIndex: 0, included: true, height: 2 }])).toBeNull();
  });
});
