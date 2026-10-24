import { describe, expect, it } from 'vitest';
import type { EditorDoc } from '../editor/model';
import {
  designHeightMm,
  screwBorderMm,
  widthForHeight,
  DEFAULT_PRINT,
  filamentMatches,
  PROJECTS,
  applyProject,
  cutoutChange,
  heightPlan,
  layersToMm,
  mixPlan,
  mixedChange,
  nextSelection,
  printOptions,
  reliefRaise,
  setShapeRaise,
  sharedRaise,
  suggestFilaments,
  testCard,
  typicalTd,
  validatePrint,
  filamentsNeeded,
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
      rim_mm: 0,
      rim_height_mm: 0,
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
      'coaster',
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
    expect(validatePrint(doc, settings({ rimMm: 2, baseLayers: 0 }))).toEqual({
      rimMm: 'A rim needs a base.',
    });
    expect(printOptions(doc, settings({ rimMm: 2 }))).toMatchObject({ rim_mm: 2 });
    expect(designHeightMm(80, 2 / 3)).toBe(53.3);
    expect(widthForHeight(60, 2 / 3)).toBe(90);
    expect(printOptions(doc, settings({ magnetMm: 10, magnetCount: 2 }))).toMatchObject({
      magnet_mm: 10,
      magnet_count: 2,
    });
    expect(
      validatePrint(doc, settings({ magnetMm: 10, magnetDepthMm: 1, magnetCount: 5 })),
    ).toEqual({
      magnetCount: 'Between 1 and 4 magnets.',
    });
    expect(printOptions(doc, settings({ screwHoles: 2, screwHoleMm: 3.5 }))).toMatchObject({
      screw_holes: 2,
      screw_hole_mm: 3.5,
    });
    expect(validatePrint(doc, settings({ screwHoles: 3 }))).toEqual({
      screwHoles: 'None, 2 or 4 holes.',
    });
    expect(validatePrint(doc, settings({ screwHoles: 4, baseLayers: 0 }))).toMatchObject({
      screwHoles: 'Screw holes need a base.',
    });
    expect(validatePrint(doc, settings({ screwHoles: 2, screwHoleMm: 0 }))).toEqual({
      screwHoleMm: 'Between 0.1 and 10 mm.',
    });
    expect(screwBorderMm(4)).toBe(7);
    expect(printOptions(doc, settings({ loopHoleMm: 4, loopPosition: 'left' }))).toMatchObject({
      loop_hole_mm: 4,
      loop_position: 'left',
    });
  });
});

describe('inlay and printer tuning', () => {
  it('sends the tuning and the relief to the backend', () => {
    const options = printOptions(
      doc,
      settings({ inlay: true, elephantFootMm: 0.2, simplifyMm: 0.1, colorGapMm: 0.15 }),
    );

    expect(options).toMatchObject({
      relief: 'inlay',
      elephant_foot_mm: 0.2,
      simplify_mm: 0.1,
      color_gap_mm: 0.15,
    });
    expect(printOptions(doc, settings())).toMatchObject({ relief: 'raised' });
  });

  it('sinks inlaid colors into the base, so the base is the full height', () => {
    expect(heightPlan(doc, settings({ inlay: true, baseLayers: 8 })).totalLayers).toBe(8);
    expect(heightPlan(doc, settings({ baseLayers: 8 })).totalLayers).toBe(10);
  });

  it('needs a base thicker than the inlaid colors, with room for a magnet below them', () => {
    expect(validatePrint(doc, settings({ inlay: true, baseLayers: 2 }))).toEqual({
      inlay: 'Needs a base of at least 3 layers (0.6 mm).',
    });
    // 2 mm pocket + 0.4 mm roof = 12 layers, below 2 inlaid layers
    expect(
      validatePrint(doc, settings({ inlay: true, baseLayers: 12, magnetMm: 10, magnetDepthMm: 2 })),
    ).toEqual({ magnetDepthMm: 'Needs a base of at least 14 layers (2.8 mm).' });
    expect(validatePrint(doc, settings({ elephantFootMm: 0.2, baseLayers: 0 }))).toEqual({
      elephantFootMm: "Elephant's foot compensation needs a base.",
    });
  });

  it('offers a flat coaster with the colors inlaid into a round base', () => {
    const coaster = applyProject(settings({ elephantFootMm: 0.2 }), 'coaster');

    expect(coaster).toMatchObject({ inlay: true, baseShape: 'circle', elephantFootMm: 0.2 });
    expect(heightPlan(doc, coaster).totalLayers).toBe(15); // the colors sink into the base
    expect(printOptions(doc, coaster)).toMatchObject({ relief: 'inlay', base_mm: 3 });
    expect(applyProject(coaster, 'sign').inlay).toBe(false);
  });

  it('keeps printer tuning when a project is chosen', () => {
    const tuned = settings({ elephantFootMm: 0.2, simplifyMm: 0.1, colorGapMm: 0.1 });

    expect(applyProject(tuned, 'keychain')).toMatchObject({
      elephantFootMm: 0.2,
      simplifyMm: 0.1,
      colorGapMm: 0.1,
    });
    expect(applyProject(settings({ printer: 'kobra-x', nozzleMm: 0.6 }), 'magnet')).toMatchObject({
      printer: 'kobra-x',
      nozzleMm: 0.6,
    });
  });

  it('counts the filaments a print needs', () => {
    expect(filamentsNeeded(doc, settings())).toBe(2);
    expect(filamentsNeeded(doc, settings({ excluded: [0] }))).toBe(1);
    const filaments = [
      { color: '#ffffff', td: 3 },
      { color: '#000000', td: 1 },
      { color: '#ff0000', td: 2 },
    ];
    expect(filamentsNeeded(doc, settings({ style: 'mixed', filaments }))).toBe(3);
  });

  it("checks the layer height against the printer's nozzle", () => {
    const kobraX = settings({ printer: 'kobra-x', nozzleMm: 0.6, layerMm: 0.08 });

    expect(validatePrint(doc, kobraX)).toEqual({
      layerMm: 'The Anycubic Kobra X prints 0.6 mm nozzle layers of 0.12–0.42 mm.',
    });
    expect(validatePrint(doc, { ...kobraX, layerMm: 0.3 })).toEqual({});
    expect(validatePrint(doc, settings({ nozzleMm: 0.6, layerMm: 0.08 }))).toEqual({});
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

describe('mirror', () => {
  it('mirrors stamps and keeps it across projects', () => {
    expect(printOptions(doc, settings()).mirror).toBe(false);
    expect(printOptions(doc, settings({ mirror: true })).mirror).toBe(true);
    expect(applyProject(settings({ mirror: true }), 'keychain').mirror).toBe(true);
  });
});

describe('cut out', () => {
  it('starts with a 3 mm plate, a 1 mm cut and the background left solid', () => {
    expect(cutoutChange(doc, settings())).toEqual({
      style: 'cutout',
      baseLayers: 15,
      colorLayers: 5,
      excluded: [0], // white background, the bottom color
    });
    // Colors already chosen stay as they are; a thicker plate is kept.
    expect(cutoutChange(doc, settings({ excluded: [1], baseLayers: 20 }))).toEqual({
      style: 'cutout',
      colorLayers: 5,
    });
  });

  it('cuts into the plate, so the model is as high as the plate', () => {
    const cutout = settings({ style: 'cutout', baseLayers: 15, colorLayers: 5, excluded: [0] });

    expect(heightPlan(doc, cutout)).toMatchObject({ totalLayers: 15 });
    expect(printOptions(doc, cutout)).toMatchObject({
      relief: 'engrave',
      base_mm: 3,
      layer_heights: JSON.stringify({ 0: 0, 1: 1, 2: 0 }),
    });
    expect(filamentsNeeded(doc, cutout)).toBe(1);
    expect(validatePrint(doc, cutout)).toEqual({});

    // Through the plate: every cut as deep as the plate.
    expect(
      JSON.parse(String(printOptions(doc, { ...cutout, cutThrough: true }).layer_heights)),
    ).toEqual({
      0: 0,
      1: 3,
      2: 0,
    });
  });

  it('needs a plate, and a cut no deeper than it', () => {
    const cutout = settings({ style: 'cutout', excluded: [0] });

    expect(validatePrint(doc, { ...cutout, baseLayers: 0 }).baseLayers).toMatch('base plate');
    expect(validatePrint(doc, { ...cutout, baseLayers: 4, colorLayers: 5 }).colorLayers).toMatch(
      'Cut through',
    );
    expect(validatePrint(doc, { ...cutout, baseLayers: 4, cutThrough: true })).toEqual({});
  });
});

describe('mixed colors', () => {
  const filaments = [
    { color: '#ffffff', td: 3 },
    { color: '#ff0000', td: 1.2 },
  ];
  const mixed = (change: Partial<PrintSettings> = {}) =>
    settings({ style: 'mixed', layerMm: 0.08, colorLayers: 15, filaments, ...change });

  it('switches to thin layers keeping heights, and suggests filaments', () => {
    const change = mixedChange(doc, settings({ layerMm: 0.2, colorLayers: 2, baseLayers: 8 }));

    expect(change).toMatchObject({
      style: 'mixed',
      layerMm: 0.08,
      colorLayers: 15,
      baseLayers: 20,
    });
    expect(change.filaments?.map((filament) => filament.color)).toEqual(['#ffffff', '#ff0000']);
    // set up already: only the style changes
    expect(mixedChange(doc, mixed())).toEqual({ style: 'mixed' });
  });

  it('suggests white and clearly different design colors with typical TDs', () => {
    expect(suggestFilaments(doc)).toEqual([
      { color: '#ffffff', td: 3 },
      { color: '#ff0000', td: 1.5 },
    ]);
    expect(typicalTd('#101010')).toBe(0.5);
    expect(typicalTd('#3a4a6b')).toBe(1);
    expect(typicalTd('#fafafa')).toBe(3);
  });

  it('mixes every printed color and sends filaments and stacks', () => {
    const plan = mixPlan(doc, mixed());

    expect([...plan.keys()]).toEqual([0, 1]);
    expect(plan.get(0)!.recipe).toEqual({ base: 0, top: [] });
    expect(mixPlan(doc, mixed({ filaments: [] })).size).toBe(0);

    const options = printOptions(doc, mixed());
    expect(options.layered).toBe(false);
    expect(JSON.parse(String(options.filaments))).toEqual(['#ffffff', '#ff0000']);
    expect(JSON.parse(String(options.color_stacks))).toMatchObject({ 0: { base: 0, top: [] } });
    expect(printOptions(doc, settings()).filaments).toBeUndefined();
  });

  it('needs valid filaments', () => {
    expect(validatePrint(doc, mixed({ filaments: [] })).filaments).toMatch('at least one');
    expect(validatePrint(doc, mixed({ filaments: [{ color: '#fff', td: 1 }] })).filaments).toMatch(
      'TD above 0',
    );
    expect(
      validatePrint(doc, mixed({ filaments: [{ color: '#ffffff', td: 0 }] })).filaments,
    ).toMatch('TD above 0');
    expect(validatePrint(doc, mixed())).toEqual({});
  });

  it('builds a test card with one patch per printed color and the same recipes', () => {
    const current = mixed({ magnetMm: 10, loopHoleMm: 3, shapeRaise: { 'p-1-0': 2 } });
    const card = testCard(doc, current);

    expect(card.doc).toMatchObject({ width: 22, height: 10 });
    expect(card.doc.groups.map((group) => [group.paletteIndex, group.fill])).toEqual([
      [0, '#ffffff'],
      [1, '#ff0000'],
    ]);
    expect(card.doc.groups[1].shapes[0].d).toBe('M12,0 H22 V10 H12 Z');
    expect(card.settings).toMatchObject({
      widthMm: 22,
      baseShape: 'rectangle',
      magnetMm: 0,
      rimMm: 0,
      loopHoleMm: 0,
      shapeRaise: {},
    });
    expect(validatePrint(card.doc, card.settings)).toEqual({});
    const stacks = (d: typeof doc, s: PrintSettings) => printOptions(d, s).color_stacks;
    expect(stacks(card.doc, card.settings)).toBe(stacks(doc, current));
  });

  it('wraps test card patches into rows', () => {
    const many: EditorDoc = {
      ...doc,
      groups: Array.from({ length: 6 }, (_, i) => ({
        paletteIndex: i,
        fill: `#0000${(i * 40).toString(16).padStart(2, '0')}`,
        shapes: [{ id: `s${i}`, d: 'M0,0 H1 V1 Z' }],
      })),
    };

    const card = testCard(many, mixed());

    expect(card.doc).toMatchObject({ width: 46, height: 22 });
    expect(card.doc.groups[5].shapes[0].d).toBe('M12,12 H22 V22 H12 Z');
  });

  it('keeps the style and filaments when a project is chosen', () => {
    expect(applyProject(mixed(), 'magnet')).toMatchObject({ style: 'mixed', filaments });
  });
});

describe('reliefRaise', () => {
  const three: EditorDoc = {
    ...doc,
    groups: [
      ...doc.groups.slice(0, 2),
      { paletteIndex: 2, fill: '#000000', shapes: [{ id: 'p-2-0', d: 'M0,0 H5 V5 H0 Z' }] },
      { paletteIndex: 3, fill: '#000000', shapes: [{ id: 'p-3-0', d: 'M5,0 H9 V5 H5 Z' }] },
    ],
  };

  it('raises darker colors one step above lighter ones', () => {
    expect(reliefRaise(three, settings(), 'dark')).toEqual({ 0: 0, 1: 1, 2: 2, 3: 3 });
    expect(reliefRaise(three, settings(), 'light', 2)).toEqual({ 2: 0, 3: 2, 1: 4, 0: 6 });
  });

  it('leaves out colors that are not printed', () => {
    expect(reliefRaise(three, settings({ excluded: [1] }), 'dark')).toEqual({ 0: 0, 2: 1, 3: 2 });
    expect(reliefRaise(doc, settings(), 'dark')).toEqual({ 0: 0, 1: 1 });
  });

  it('matches the nearest filament only for colors printed in their own filament', () => {
    const white = { name: 'White', color: '#ffffff' };
    const red = { name: 'Red', color: '#ee1111' };

    const matches = filamentMatches(doc, settings(), [white, red]);
    expect(matches?.get(0)).toEqual({ filament: white, delta: 0 });
    expect(matches?.get(1)?.filament).toBe(red);
    expect(filamentMatches(doc, settings({ style: 'mixed' }), [white])).toBeUndefined();
    expect(filamentMatches(doc, settings({ style: 'cutout' }), [white])).toBeUndefined();
    expect(filamentMatches(doc, settings(), [])?.size).toBe(0);
  });
});
