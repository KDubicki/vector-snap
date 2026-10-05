import { describe, expect, it } from 'vitest';
import { EXPORT_FORMATS, defaultValues, exportFileName, validate } from './exportFormats';

const stl = EXPORT_FORMATS.find((format) => format.id === 'stl')!;

describe('export formats', () => {
  it('provides defaults for every option', () => {
    expect(defaultValues(stl)).toEqual({ width_mm: 100, base_mm: 1, layer_mm: 1, layered: true });
  });

  it('validates ranges and types', () => {
    expect(validate(stl, defaultValues(stl))).toEqual({});
    expect(
      validate(stl, { width_mm: 0, base_mm: Number.NaN, layer_mm: 1, layered: 'yes' as never }),
    ).toEqual({
      width_mm: 'Must be between 1 and 10000.',
      base_mm: 'Enter a number.',
      layered: 'Invalid value.',
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
