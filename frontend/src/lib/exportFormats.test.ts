import { describe, expect, it } from 'vitest';
import {
  EXPORT_FORMATS,
  autoLayerHeight,
  snapToLayers,
  stackPositions,
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
      base_shape: 'outline',
      base_margin_mm: 0,
      layer_mm: 1,
      stack_order: 'document',
      loop_hole_mm: 0,
      magnet_mm: 0,
      magnet_depth_mm: 2,
      min_feature_mm: 0,
      print_layer_mm: 0,
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
        base_shape: 'star',
        base_margin_mm: -1,
        layer_mm: 1,
        stack_order: 'document',
        loop_hole_mm: 0,
        magnet_mm: 0,
        magnet_depth_mm: 2,
        min_feature_mm: 11,
        print_layer_mm: 0.2,
        layered: 'yes' as never,
        mirror: false,
      }),
    ).toEqual({
      width_mm: 'Must be between 1 and 10000.',
      base_mm: 'Enter a number.',
      base_shape: 'Choose one of the options.',
      base_margin_mm: 'Must be between 0 and 100.',
      min_feature_mm: 'Must be between 0 and 10.',
      layered: 'Invalid value.',
    });
  });

  it('requires a base plate for a hanging loop', () => {
    const values = { ...defaultValues(stl), loop_hole_mm: 4 };

    expect(validate(stl, values)).toEqual({});
    expect(validate(stl, { ...values, base_mm: 0 })).toEqual({
      loop_hole_mm: 'A hanging loop needs a base plate.',
    });
  });

  it('requires a base plate thick enough for the magnet pocket', () => {
    const values = { ...defaultValues(stl), magnet_mm: 10, magnet_depth_mm: 2 };

    expect(validate(stl, values)).toEqual({
      magnet_depth_mm: 'Needs a base plate of at least 2.4 mm.',
    });
    expect(validate(stl, { ...values, base_mm: 2.4 })).toEqual({});
    expect(validate(stl, { ...values, magnet_mm: 0 })).toEqual({});
    // the base is rounded to printer layers first: 2.4 -> 2.1 with 0.7 mm layers
    expect(validate(stl, { ...values, base_mm: 2.4, print_layer_mm: 0.7 })).toEqual({
      magnet_depth_mm: 'Needs a base plate of at least 2.4 mm.',
    });
  });

  it('offers 3MF with the same model options and per-color heights as STL', () => {
    const threeMf = EXPORT_FORMATS.find((format) => format.id === '3mf')!;

    expect(threeMf.extension).toBe('3mf');
    expect(threeMf.options).toBe(stl.options);
    expect(threeMf.perColorHeights).toBe(true);
  });

  it('offers a lithophane built from the original image', () => {
    const lithophane = EXPORT_FORMATS.find((format) => format.id === 'lithophane')!;
    const values = defaultValues(lithophane);

    expect(lithophane.source).toBe('image');
    expect(exportFileName('photo.jpg', lithophane.extension)).toBe('photo.lithophane.stl');
    expect(values).toEqual({
      width_mm: 100,
      min_thickness_mm: 0.8,
      max_thickness_mm: 3,
      resolution_mm: 0.2,
      frame_mm: 0,
      invert: false,
    });
    expect(validate(lithophane, values)).toEqual({});
    expect(validate(lithophane, { ...values, min_thickness_mm: 3 })).toEqual({
      max_thickness_mm: 'Must be thicker than the thinnest areas.',
    });
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
    expect(autoLayerHeight(2, { layer_mm: 0.5, layered: true, print_layer_mm: 0.2 })).toBe(1.6);
  });

  it('orders colors by brightness like the backend', () => {
    const fills = ['#808080', '#ffffff', '#000000', '#808080'];

    expect(stackPositions(fills, 'document')).toEqual([0, 1, 2, 3]);
    expect(stackPositions(fills, 'light_to_dark')).toEqual([1, 0, 3, 2]);
    expect(stackPositions(fills, 'dark_to_light')).toEqual([1, 3, 0, 2]);
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

  it('snaps heights to whole printer layers like the backend', () => {
    expect(snapToLayers(1, 0)).toBe(1);
    expect(snapToLayers(0, 0.2)).toBe(0);
    expect(snapToLayers(0.3, 0.2)).toBe(0.4);
    expect(snapToLayers(0.05, 0.2)).toBe(0.2);
    expect(snapToLayers(1, 0.12)).toBe(0.96);
  });

  it('renders png in the browser with a width and background', () => {
    const png = EXPORT_FORMATS.find((format) => format.id === 'png')!;

    expect(png.client).toBe(true);
    expect(defaultValues(png)).toEqual({ width_px: 2048, background: 'transparent' });
    expect(validate(png, { width_px: 8, background: 'pink' })).toEqual({
      width_px: 'Must be between 16 and 16384.',
      background: 'Choose one of the options.',
    });
  });
});
