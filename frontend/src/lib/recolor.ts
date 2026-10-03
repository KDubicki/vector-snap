import { hexToRgb } from './color';

/**
 * Recolor RGBA pixels of a decoded quantized image.
 *
 * The browser decodes the indexed PNG from /quantize to RGBA, losing palette indices.
 * Palette colors are exact, so each pixel's color identifies its index; it is replaced by
 * the final color of that index. Transparent pixels (alpha 0) are left untouched.
 */
export function recolorPixels(
  source: Uint8ClampedArray,
  originalPalette: string[],
  targetPalette: string[],
): Uint8ClampedArray {
  const mapping = new Map<number, [number, number, number]>();
  originalPalette.forEach((hex, index) => {
    const [r, g, b] = hexToRgb(hex);
    const key = (r << 16) | (g << 8) | b;
    if (!mapping.has(key)) mapping.set(key, hexToRgb(targetPalette[index] ?? hex));
  });

  const output = new Uint8ClampedArray(source);
  for (let i = 0; i < output.length; i += 4) {
    if (output[i + 3] === 0) continue;
    const target = mapping.get((output[i] << 16) | (output[i + 1] << 8) | output[i + 2]);
    if (target) {
      output[i] = target[0];
      output[i + 1] = target[1];
      output[i + 2] = target[2];
    }
  }
  return output;
}
