import { hexToRgb } from './color';

/**
 * Recolor RGBA pixels of a decoded quantized image.
 *
 * The browser decodes the indexed PNG from /quantize to RGBA, losing palette indices.
 * Palette colors are exact, so each pixel's color identifies its index; it is replaced by
 * the final color of that index, or made transparent when the target is `null` (a removed
 * color). Pixels that are already transparent (alpha 0) are left untouched.
 */
export function recolorPixels(
  source: Uint8ClampedArray,
  originalPalette: string[],
  targetPalette: (string | null)[],
): Uint8ClampedArray {
  const mapping = new Map<number, [number, number, number] | null>();
  originalPalette.forEach((hex, index) => {
    const [r, g, b] = hexToRgb(hex);
    const key = (r << 16) | (g << 8) | b;
    if (mapping.has(key)) return;
    const target = targetPalette[index];
    mapping.set(key, target === null ? null : hexToRgb(target ?? hex));
  });

  const output = new Uint8ClampedArray(source);
  for (let i = 0; i < output.length; i += 4) {
    if (output[i + 3] === 0) continue;
    const target = mapping.get((output[i] << 16) | (output[i + 1] << 8) | output[i + 2]);
    if (target === null) {
      output[i + 3] = 0;
    } else if (target) {
      output[i] = target[0];
      output[i + 1] = target[1];
      output[i + 2] = target[2];
    }
  }
  return output;
}

/**
 * Make the pixels of `hex` that reach the image border transparent, in place: the
 * removed background, while the same color enclosed by the motif stays (as the backend's
 * `background` in /vectorize). Regions connect side by side, not diagonally, and pass
 * through pixels that are already transparent. `pixels` holds the original colors.
 */
export function clearBorderRegions(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  hex: string,
): Uint8ClampedArray {
  const [r, g, b] = hexToRgb(hex);
  const count = width * height;
  const colored = new Uint8Array(count);
  const passable = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const isColor =
      pixels[o + 3] !== 0 && pixels[o] === r && pixels[o + 1] === g && pixels[o + 2] === b;
    colored[i] = isColor ? 1 : 0;
    passable[i] = isColor || pixels[o + 3] === 0 ? 1 : 0;
  }
  const seen = new Uint8Array(count);
  const stack: number[] = [];
  const visit = (i: number) => {
    if (passable[i] && !seen[i]) {
      seen[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < width; x++) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    visit(y * width);
    visit(y * width + width - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    if (colored[i]) pixels[i * 4 + 3] = 0;
    const x = i % width;
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i < count - width) visit(i + width);
  }
  return pixels;
}
