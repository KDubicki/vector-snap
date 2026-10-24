import { describe, expect, it } from 'vitest';
import { DEFAULT_PRINT } from './printPlan';
import { PRESET_KIND, presetJson, readPreset } from './printPreset';

const preset = (settings: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ kind: PRESET_KIND, version: 1, settings, ...extra });

describe('print settings file', () => {
  it('saves the print settings without the per-design choices and reads them back', () => {
    const settings = {
      ...DEFAULT_PRINT,
      project: 'coaster' as const,
      printer: 'kobra-x' as const,
      widthMm: 120,
      inlay: true,
      style: 'cutout' as const,
      cutThrough: true,
      filaments: [{ color: '#FFFFFF', td: 3 }],
      colorRaise: { 1: 2 },
      excluded: [3],
      shapeRaise: { 'p-0-0': 1 },
    };

    const json = presetJson(settings);
    expect(JSON.parse(json)).toMatchObject({ kind: PRESET_KIND, version: 1 });
    expect(json).not.toMatch(/colorRaise|excluded|shapeRaise/);

    const expected: Record<string, unknown> = {
      ...settings,
      filaments: [{ color: '#ffffff', td: 3 }],
    };
    for (const key of ['colorRaise', 'excluded', 'shapeRaise']) delete expected[key];
    expect(readPreset(json)).toEqual(expected);
  });

  it('keeps fields a file leaves out and ignores unknown or per-design ones', () => {
    expect(readPreset(preset({ widthMm: 50, colorRaise: { 0: 9 }, later: true }))).toEqual({
      widthMm: 50,
    });
  });

  it('rejects files that are not print settings or have invalid fields', () => {
    expect(() => readPreset('{oops')).toThrow('not JSON');
    expect(() => readPreset(JSON.stringify({ widthMm: 50 }))).toThrow('Not a VectorSnap');
    expect(() => readPreset(preset({}, { version: 2 }))).toThrow('newer VectorSnap');
    expect(() => readPreset(preset({ widthMm: '50' }))).toThrow('invalid "widthMm"');
    expect(() => readPreset(preset({ inlay: 1 }))).toThrow('invalid "inlay"');
    expect(() => readPreset(preset({ printer: 'ender-3' }))).toThrow('invalid "printer"');
    expect(() => readPreset(preset({ loopPosition: 'corner' }))).toThrow('invalid "loopPosition"');
    expect(() => readPreset(preset({ baseShape: 'star' }))).toThrow('invalid "baseShape"');
    expect(readPreset(preset({ baseShape: 'hexagon' })).baseShape).toBe('hexagon');
    expect(() => readPreset(preset({ layerMm: null }))).toThrow('invalid "layerMm"');
    expect(() => readPreset(preset({ filaments: [{ color: 'red', td: 1 }] }))).toThrow(
      'invalid "filaments"',
    );
  });
});
