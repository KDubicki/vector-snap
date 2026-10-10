import { describe, expect, it } from 'vitest';
import {
  POOR_MATCH_DELTA_E,
  bestRecipe,
  colorStacks,
  deltaE,
  predictColor,
  recipeSlabs,
  toLab,
  type Filament,
  type Recipe,
} from './mixing';

const WHITE: Filament = { color: '#ffffff', td: 3 };
const RED: Filament = { color: '#ff0000', td: 1.2 };
const BLUE: Filament = { color: '#0000ff', td: 1.2 };
const BLACK: Filament = { color: '#000000', td: 0.4 };
const FOUR = [WHITE, RED, BLUE, BLACK];
const heights = { layerMm: 0.08, baseLayers: 10, colorLayers: 10 };

describe('color mixing model', () => {
  it('converts to Lab and measures color differences', () => {
    expect(toLab('#ffffff')[0]).toBeCloseTo(100, 1);
    expect(toLab('#000000')[0]).toBeCloseTo(0, 1);
    expect(deltaE('#ff0000', '#ff0000')).toBe(0);
    expect(deltaE('#000000', '#ffffff')).toBeCloseTo(100, 0);
  });

  it('stacks the base plate, the base filament and the top layers', () => {
    const recipe: Recipe = {
      base: 0,
      top: [
        { filament: 1, layers: 2 },
        { filament: 2, layers: 3 },
      ],
    };

    expect(recipeSlabs(recipe, heights)).toEqual([
      { filament: 0, layers: 10 },
      { filament: 0, layers: 5 },
      { filament: 2, layers: 3 },
      { filament: 1, layers: 2 },
    ]);
    // a low color keeps the topmost layers
    expect(recipeSlabs(recipe, { baseLayers: 0, colorLayers: 3 })).toEqual([
      { filament: 2, layers: 1 },
      { filament: 1, layers: 2 },
    ]);
  });

  it('predicts thin translucent layers blending with what lies below', () => {
    // 0.16 mm of red over the white base plate lets white through, 0.8 mm hardly
    const thin = predictColor(FOUR, { base: 1, top: [] }, { ...heights, colorLayers: 2 });
    const thick = predictColor(FOUR, { base: 1, top: [] }, heights);
    const pink = predictColor(FOUR, { base: 0, top: [{ filament: 1, layers: 2 }] }, heights);
    const deeper = predictColor(FOUR, { base: 0, top: [{ filament: 1, layers: 5 }] }, heights);

    expect(deltaE(thin, '#ff0000')).toBeGreaterThan(POOR_MATCH_DELTA_E);
    expect(deltaE(thick, '#ff0000')).toBeLessThan(deltaE(thin, '#ff0000') / 3);
    expect(pink).toMatch(/^#ff[a-f0-9]{4}$/); // red with white showing through
    expect(deltaE(pink, '#ffffff')).toBeLessThan(deltaE(deeper, '#ffffff'));
    // an opaque filament covers everything below
    const black = predictColor(FOUR, { base: 0, top: [{ filament: 3, layers: 5 }] }, heights);
    expect(deltaE(black, '#000000')).toBeLessThan(2.3);
  });

  it('finds the filaments themselves and mixes for colors between them', () => {
    const red = bestRecipe('#ff0000', FOUR, heights);
    expect([red.recipe.base, ...red.recipe.top.map((layer) => layer.filament)]).toContain(1);
    expect(red.deltaE).toBeLessThan(5);
    expect(bestRecipe('#000000', FOUR, heights).deltaE).toBeLessThan(1);

    const pink = bestRecipe('#ff9a9a', FOUR, heights);
    // white and red, one thinly over the other
    const used = [pink.recipe.base, ...pink.recipe.top.map((layer) => layer.filament)];
    expect(used.sort()).toEqual([0, 1]);
    expect(pink.deltaE).toBeLessThan(POOR_MATCH_DELTA_E);

    // purple: red and blue layered, never a pure filament
    const purple = bestRecipe('#7f007f', FOUR, heights);
    expect(purple.recipe.top.length).toBeGreaterThan(0);
    expect(purple.deltaE).toBeLessThan(deltaE('#7f007f', '#ff0000'));
  });

  it('reports colors the filaments cannot mix as poor matches', () => {
    expect(bestRecipe('#00ff00', FOUR, heights).deltaE).toBeGreaterThan(POOR_MATCH_DELTA_E);
  });

  it('works with a single filament and fails without any', () => {
    expect(bestRecipe('#123456', [WHITE], heights).recipe).toEqual({ base: 0, top: [] });
    expect(() => bestRecipe('#123456', [], heights)).toThrow('At least one filament');
  });

  it('builds the color_stacks export option in mm', () => {
    const recipes = new Map<number, Recipe>([
      [0, { base: 0, top: [] }],
      [3, { base: 1, top: [{ filament: 2, layers: 3 }] }],
    ]);

    expect(colorStacks(recipes, 0.08)).toEqual({
      0: { base: 0, top: [] },
      3: { base: 1, top: [[2, 0.24]] },
    });
  });
});
