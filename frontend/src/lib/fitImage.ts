/**
 * Scale an image the backend would refuse down in the browser: phone photos are often
 * larger than `max_image_dimension` (an 8064 × 6048 px 48 MP photo) or the upload limit,
 * and a design needs far fewer pixels than that. See docs/07-frontend.md#step-1--upload-.
 */

export interface ImageLimits {
  /** Longest side the backend takes, in px (`max_image_dimension`). */
  maxDimension: number;
  /** Largest upload, in bytes (`max_upload_mb`). */
  maxBytes: number;
}

export interface Resize {
  width: number;
  height: number;
  toWidth: number;
  toHeight: number;
}

export interface FittedImage {
  file: File;
  /** How it was scaled down; null when the image was sent as chosen. */
  resized: Resize | null;
}

// Each try that is still too many bytes shrinks the sides by this much (about half the
// pixels), up to MAX_TRIES times.
const SHRINK_STEP = 0.75;
const MAX_TRIES = 6;
const JPEG_QUALITY = 0.92;

/** Scale bringing the longer side within `maxDimension` (1: it fits). */
export function fitScale(width: number, height: number, maxDimension: number): number {
  return Math.min(1, maxDimension / Math.max(width, height));
}

function encode(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  type: string,
): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return Promise.resolve(null);
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, type, JPEG_QUALITY));
}

function renamed(name: string, type: string): string {
  const extension = type === 'image/jpeg' ? '.jpg' : '.png';
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}${extension}`;
}

/**
 * The file as chosen when the backend takes it, otherwise scaled down until it does: the
 * longer side to `maxDimension`, then smaller while it is over `maxBytes`. A JPEG stays a
 * JPEG (quality 0.92); other formats become PNG, which keeps transparency and flat colors
 * exact. The browser applies the EXIF orientation and converts colors to sRGB, as the
 * backend would. A file the browser cannot decode or draw (out of memory on a huge
 * photo), or that does not fit after `MAX_TRIES`, is returned as chosen: the backend
 * then explains what is wrong.
 */
export async function fitImage(file: File, limits: ImageLimits): Promise<FittedImage> {
  const asChosen = { file, resized: null };
  if (typeof createImageBitmap !== 'function') return asChosen;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return asChosen;
  }
  try {
    const { width, height } = bitmap;
    let scale = fitScale(width, height, limits.maxDimension);
    if (scale === 1 && file.size <= limits.maxBytes) return asChosen;

    const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    for (let attempt = 0; attempt < MAX_TRIES; attempt += 1) {
      const toWidth = Math.max(1, Math.round(width * scale));
      const toHeight = Math.max(1, Math.round(height * scale));
      const blob = await encode(bitmap, toWidth, toHeight, type);
      if (!blob) return asChosen;
      if (blob.size <= limits.maxBytes) {
        const name = type === file.type ? file.name : renamed(file.name, type);
        const fitted = new File([blob], name, {
          type,
          lastModified: file.lastModified,
        });
        return { file: fitted, resized: { width, height, toWidth, toHeight } };
      }
      scale *= SHRINK_STEP;
    }
    return asChosen;
  } catch {
    return asChosen;
  } finally {
    bitmap.close();
  }
}
