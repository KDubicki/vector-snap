import { useEffect, useRef, useState } from 'react';
import { dataUrl } from '../lib/base64';
import { clearBorderRegions, recolorPixels } from '../lib/recolor';
import type { EncodedImage } from '../types/api';

interface QuantizedPreviewProps {
  image: EncodedImage;
  originalPalette: string[];
  /** Final color per palette index; `null` = removed (shown transparent). */
  targetPalette: (string | null)[];
  /** Original color of the removed background: left out where it reaches the border. */
  background?: string | null;
}

/** Shows the quantized image, recolored client-side whenever the palette changes. */
export function QuantizedPreview({
  image,
  originalPalette,
  targetPalette,
  background = null,
}: QuantizedPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<ImageData | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d', { willReadFrequently: true });
      if (cancelled || !canvas || !context) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      context.drawImage(img, 0, 0);
      baseRef.current = context.getImageData(0, 0, canvas.width, canvas.height);
      setVersion((v) => v + 1);
    };
    img.src = dataUrl(image.data, image.media_type);
    return () => {
      cancelled = true;
    };
  }, [image]);

  useEffect(() => {
    const base = baseRef.current;
    const context = canvasRef.current?.getContext('2d');
    if (!base || !context) return;
    const pixels = recolorPixels(base.data, originalPalette, targetPalette);
    if (background) {
      // Found on the original colors, as the recolored background may match the motif.
      const cleared = clearBorderRegions(
        new Uint8ClampedArray(base.data),
        base.width,
        base.height,
        background,
      );
      for (let i = 3; i < pixels.length; i += 4) if (cleared[i] === 0) pixels[i] = 0;
    }
    context.putImageData(new ImageData(pixels, base.width, base.height), 0, 0);
  }, [version, originalPalette, targetPalette, background]);

  return <canvas ref={canvasRef} className="preview__image checkerboard" />;
}
