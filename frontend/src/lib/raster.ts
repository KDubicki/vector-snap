/**
 * Rasterize the edited SVG to PNG in the browser (no server round trip).
 * See docs/13-export-formats.md#png.
 */

/** Largest canvas Safari draws (16.7 Mpx); Chrome and Firefox allow more. */
export const MAX_CANVAS_PIXELS = 16_777_216;

export interface RasterSize {
  width: number;
  height: number;
  /** The requested width was reduced to stay within `MAX_CANVAS_PIXELS`. */
  limited: boolean;
}

/** Output size for a document rendered `width` pixels wide, keeping its aspect ratio. */
export function rasterSize(docWidth: number, docHeight: number, width: number): RasterSize {
  const requested = Math.max(1, Math.round(width));
  const height = Math.max(1, Math.round((requested * docHeight) / docWidth));
  if (requested * height <= MAX_CANVAS_PIXELS) return { width: requested, height, limited: false };
  const scale = Math.sqrt(MAX_CANVAS_PIXELS / (requested * height));
  return {
    width: Math.max(1, Math.floor(requested * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    limited: true,
  };
}

/** Render an SVG document to a PNG of `size`; `background` null keeps transparency. */
export async function svgToPng(
  svg: string,
  size: Pick<RasterSize, 'width' | 'height'>,
  background: string | null,
): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is not available in this browser.');
    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, size.width, size.height);
    }
    context.drawImage(image, 0, 0, size.width, size.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('The image is too large to render.'))),
        'image/png',
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
