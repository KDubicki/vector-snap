/**
 * Mixed colors from a few filaments ("filament painting", as in HueForge): thin layers of
 * translucent filament over another filament blend into new colors seen from above.
 *
 * How much of what lies below shows through a filament is given by its transmission
 * distance (TD, as listed by HueForge and filament makers): the thickness in mm at which
 * practically no light passes any more (taken as 5 %). Light fades exponentially in the
 * material (Beer–Lambert) and, seen from above, crosses a layer twice — down to what lies
 * below and back up — so a layer of thickness t lets T = e^(−2 · ln 20 · t / TD) of the
 * color below through and covers the rest, mixed in linear light. This is an
 * approximation (real filaments also scatter and tint), so predictions are a guide and a
 * test print with the actual filaments is worth it. See docs/07-frontend.md.
 */
import { deltaE, hexToRgb, rgbToHex, srgbToLinear, type Rgb } from './color';

export interface Filament {
  color: string;
  /** Transmission distance (mm); higher is more translucent. */
  td: number;
}

/** Filaments of one color: thin `top` layers (from the top surface down) over `base`. */
export interface Recipe {
  base: number;
  top: { filament: number; layers: number }[];
}

export interface StackHeights {
  /** Printer layer height (mm). */
  layerMm: number;
  /** Base plate (printed with the first filament), in layers. */
  baseLayers: number;
  /** Height of the color above the base, in layers. */
  colorLayers: number;
}

/** Most thin layers of one filament on top; more rarely changes the look. */
export const MAX_TOP_LAYERS = 6;
/** ΔE above which a mixed color visibly differs from the design color. */
export const POOR_MATCH_DELTA_E = 10;
// Light crosses a layer twice; one pass through a TD-thick layer leaves 5 % (1/20).
const ATTENUATION = 2 * Math.log(20);
// Slight preference for fewer filament changes when two recipes look alike.
const SEGMENT_PENALTY = 0.5;

function fromLinear(value: number): number {
  const c = Math.min(1, Math.max(0, value));
  const srgb = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(srgb * 255);
}

type Linear = [number, number, number];

const linear = (hex: string): Linear => hexToRgb(hex).map(srgbToLinear) as Linear;

/** Layers of each filament from the bottom of the model up: base plate, base, top layers. */
export function recipeSlabs(
  recipe: Recipe,
  { baseLayers, colorLayers }: Omit<StackHeights, 'layerMm'>,
): { filament: number; layers: number }[] {
  let remaining = colorLayers;
  const top: { filament: number; layers: number }[] = [];
  for (const layer of recipe.top) {
    const layers = Math.min(layer.layers, remaining);
    if (layers <= 0) break;
    top.push({ filament: layer.filament, layers });
    remaining -= layers;
  }
  return [
    { filament: 0, layers: baseLayers },
    { filament: recipe.base, layers: remaining },
    ...top.reverse(),
  ].filter((slab) => slab.layers > 0);
}

/** Predicted color of a recipe seen from above. */
export function predictColor(filaments: Filament[], recipe: Recipe, heights: StackHeights): string {
  const slabs = recipeSlabs(recipe, heights);
  // The bottom is lit from above only: the lowest filament shows its own color.
  let color: Linear = linear(filaments[slabs[0]?.filament ?? recipe.base].color);
  for (const slab of slabs) {
    const filament = filaments[slab.filament];
    const thickness = slab.layers * heights.layerMm;
    const cover = 1 - Math.exp((-ATTENUATION * thickness) / Math.max(filament.td, 0.01));
    const own = linear(filament.color);
    color = color.map((value, i) => value + (own[i] - value) * cover) as Linear;
  }
  return rgbToHex(color.map(fromLinear) as Rgb);
}

export interface MixMatch {
  recipe: Recipe;
  predicted: string;
  deltaE: number;
}

/** Every recipe worth trying: a base filament with up to two thin filaments on top. */
function candidateRecipes(filamentCount: number, colorLayers: number): Recipe[] {
  const maxTop = Math.min(MAX_TOP_LAYERS, colorLayers);
  const recipes: Recipe[] = [];
  for (let base = 0; base < filamentCount; base += 1) {
    recipes.push({ base, top: [] });
    for (let upper = 0; upper < filamentCount; upper += 1) {
      if (upper === base) continue;
      for (let k = 1; k <= maxTop; k += 1) {
        recipes.push({ base, top: [{ filament: upper, layers: k }] });
        for (let lower = 0; lower < filamentCount; lower += 1) {
          if (lower === upper || lower === base) continue;
          for (let j = 1; k + j <= maxTop; j += 1) {
            recipes.push({
              base,
              top: [
                { filament: upper, layers: k },
                { filament: lower, layers: j },
              ],
            });
          }
        }
      }
    }
  }
  return recipes;
}

/** The recipe whose predicted color is closest to `target`. */
export function bestRecipe(target: string, filaments: Filament[], heights: StackHeights): MixMatch {
  let best: MixMatch | null = null;
  let bestScore = Infinity;
  for (const recipe of candidateRecipes(filaments.length, heights.colorLayers)) {
    const predicted = predictColor(filaments, recipe, heights);
    const difference = deltaE(target, predicted);
    const score = difference + SEGMENT_PENALTY * recipe.top.length;
    if (score < bestScore) {
      best = { recipe, predicted, deltaE: difference };
      bestScore = score;
    }
  }
  if (!best) throw new Error('At least one filament is needed.');
  return best;
}

/** `color_stacks` export option: per palette index, filaments from the top down in mm. */
export function colorStacks(
  recipes: Map<number, Recipe>,
  layerMm: number,
): Record<string, { base: number; top: [number, number][] }> {
  return Object.fromEntries(
    [...recipes].map(([index, recipe]) => [
      index,
      {
        base: recipe.base,
        top: recipe.top.map(({ filament, layers }) => [
          filament,
          Number((layers * layerMm).toFixed(4)),
        ]),
      },
    ]),
  );
}
