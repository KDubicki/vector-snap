import { useEffect, useRef, useState } from 'react';
import { dataUrl } from '../lib/base64';
import { recolorPixels } from '../lib/recolor';
import type { EncodedImage } from '../types/api';

interface QuantizedPreviewProps {
  image: EncodedImage;
  originalPalette: string[];
  targetPalette: string[];
}

/** Shows the quantized image, recolored client-side whenever the palette changes. */
export function QuantizedPreview({ image, originalPalette, targetPalette }: QuantizedPreviewProps) {
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
    context.putImageData(new ImageData(pixels, base.width, base.height), 0, 0);
  }, [version, originalPalette, targetPalette]);

  return <canvas ref={canvasRef} className="preview__image checkerboard" />;
}
