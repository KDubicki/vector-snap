import { describe, expect, it } from 'vitest';
import type { EditorDoc } from '../editor/model';
import {
  DEFAULT_PRINT,
  PROJECTS,
  applyProject,
  heightPlan,
  layersToMm,
  nextSelection,
  printOptions,
  setShapeRaise,
  sharedRaise,
  validatePrint,
  type PrintSettings,
} from './printPlan';

const doc: EditorDoc = {
  width: 100,
  height: 50,
  groups: [
    { paletteIndex: 0, fill: '#ffffff', shapes: [{ id: 'p-0-0', d: 'M0,0 H100 V50 H0 Z' }] },
    {
      paletteIndex: 1,
      fill: '#ff0000',
      shapes: [
        { id: 'p-1-0', d: 'M10,10 H20 V20 H10 Z' },
        { id: 'p-1-1', d: 'M30,10 H40 V20 H30 Z' },
      ],
    },
    { paletteIndex: 2, fill: '#000000', shapes: [] },
  ],
};

const settings = (change: Partial<PrintSettings> = {}): PrintSettings => ({
  ...DEFAULT_PRINT,
  ...change,
});

describe('print plan', () => {
  it('converts layers to millimetres without float noise', () => {
    expect(layersToMm(3, 0.2)).toBe(0.6);
    expect(layersToMm(12, 0.2)).toBe(2.4);
    expect(layersToMm(7, 0.12)).toBe(0.84);
  });

  it('gives every color the same height in flat mode (AMS)', () => {
    const plan = heightPlan(doc, settings({ style: 'flat', colorLayers: 2, baseLayers: 8 }));

    expect([...plan.colors]).toEqual([
      [0, 2],
      [1, 2],
    ]);
    expect(plan.totalLayers).toBe(10);
  });

  it('steps colors in stepped mode and adds extra layers per color', () => {
    const plan = heightPlan(doc, settings({ style: 'stepped', colorRaise: { 0: 1 } }));

    expect([...plan.colors]).toEqual([
      [0, 3],
      [1, 4],
    ]);
  });

  it('raises single elements above their color', () => {
    const plan = heightPlan(doc, settings({ shapeRaise: { 'p-1-1': 3, 'p-1-0': 0 } }));

    expect([...plan.shapes]).toEqual([['p-1-1', 5]]);
    expect(plan.totalLayers).toBe(8 + 5);
  });

  it('leaves excluded colors and their raised elements out', () => {
    const plan = heightPlan(doc, settings({ excluded: [1], shapeRaise: { 'p-1-1': 3 } }));

    expect([...plan.colors.keys()]).toEqual([0]);
    expect(plan.shapes.size).toBe(0);
  });

  it('builds explicit export options', () => {
    const options = printOptions(
      doc,
      settings({ excluded: [0], shapeRaise: { 'p-1-0': 4 }, layerMm: 0.2 }),
    );

    expect(options).toMatchObject({
      base_mm: 1.6,
      layer_mm: 0.4,
      layered: false,
      print_layer_mm: 0.2,
      min_feature_mm: 0.4,
      stack_order: 'document',
      mirror: false,
    });
    expect(JSON.parse(String(options.layer_heights))).toEqual({ '0': 0, '1': 0.4, '2': 0 });
    expect(JSON.parse(String(options.shape_heights))).toEqual({ 'p-1-0': 1.2 });
  });

  it('applies projects but keeps colors and raised elements', () => {
    const current = settings({ excluded: [0], shapeRaise: { 'p-1-0': 2 } });
    const magnet = applyProject(current, 'magnet');

    expect(magnet).toMatchObject({ project: 'magnet', magnetMm: 10.2, baseLayers: 12 });
    expect(magnet.excluded).toEqual([0]);
    expect(magnet.shapeRaise).toEqual({ 'p-1-0': 2 });
    expect(applyProject(magnet, 'custom')).toEqual({ ...magnet, project: 'custom' });
    expect(PROJECTS.map((project) => project.id)).toEqual([
      'magnet',
      'keychain',
      'ornament',
      'sign',
      'custom',
    ]);
  });

  it('every project is valid for a simple design', () => {
    for (const project of PROJECTS) {
      expect(validatePrint(doc, applyProject(DEFAULT_PRINT, project.id))).toEqual({});
    }
  });

  it('explains settings the backend would reject', () => {
    expect(
      validatePrint(
        doc,
        settings({ magnetMm: 10, magnetDepthMm: 2, baseLayers: 8, excluded: [0, 1] }),
      ),
    ).toEqual({
      magnetDepthMm: 'Needs a base of at least 12 layers (2.4 mm).',
      colors: 'Include at least one color.',
    });
    expect(validatePrint(doc, settings({ loopHoleMm: 4, baseLayers: 0 }))).toEqual({
      loopHoleMm: 'A hanging loop needs a base.',
    });
  });
});

describe('raised elements', () => {
  it('sets and clears extra layers for shapes', () => {
    const raised = setShapeRaise({ a: 1 }, ['a', 'b'], 3);

    expect(raised).toEqual({ a: 3, b: 3 });
    expect(setShapeRaise(raised, ['a'], 0)).toEqual({ b: 3 });
  });

  it('reports the raise shared by a selection', () => {
    expect(sharedRaise({ a: 2, b: 2 }, ['a', 'b'])).toBe(2);
    expect(sharedRaise({ a: 2 }, ['a', 'b'])).toBeNull();
    expect(sharedRaise({}, ['a'])).toBe(0);
  });

  it('selects with clicks and toggles with modifier clicks', () => {
    expect(nextSelection([], 'a', false)).toEqual(['a']);
    expect(nextSelection(['a'], 'b', false)).toEqual(['b']);
    expect(nextSelection(['a'], 'a', false)).toEqual([]);
    expect(nextSelection(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(nextSelection(['a', 'b'], 'a', true)).toEqual(['b']);
    expect(nextSelection(['a'], null, false)).toEqual([]);
    expect(nextSelection(['a'], null, true)).toEqual(['a']);
  });
});
