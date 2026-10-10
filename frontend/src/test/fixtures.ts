import { vi } from 'vitest';
import { parseSvg, type EditorDoc } from '../editor/model';
import type { QuantizeResponse, VectorizeResponse } from '../types/api';

/** A small design: white background, two red squares (one with its own blue color). */
export function sampleDoc(): EditorDoc {
  return parseSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">' +
      '<g data-palette-index="0" fill="#ffffff"><path id="p-0-0" d="M0,0 H100 V50 H0 Z"/></g>' +
      '<g data-palette-index="1" fill="#ff0000">' +
      '<path id="p-1-0" d="M10,10 H30 V30 H10 Z"/>' +
      '<path id="p-1-1" d="M50,10 H60 V20 H50 Z" fill="#0000ff"/></g></svg>',
  );
}

/** API responses for a two-color 2 × 1 image. */
export const QUANTIZED: QuantizeResponse = {
  width: 2,
  height: 1,
  palette: [
    { index: 0, hex: '#ff0000', coverage: 0.5 },
    { index: 1, hex: '#00ff00', coverage: 0.5 },
  ],
  has_transparency: false,
  background_index: 0,
  image: { media_type: 'image/png', encoding: 'base64', data: btoa('png') },
};

export const VECTORIZED: VectorizeResponse = {
  width: 2,
  height: 1,
  palette: QUANTIZED.palette,
  stats: { paths: 2, bytes: 100, duration_ms: 5 },
  svg:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">' +
    '<g data-palette-index="0" fill="#ff0000"><path id="p-0-0" d="M0,0 L10,0 L10,10 Z"/></g>' +
    '<g data-palette-index="1" fill="#00ff00"><path id="p-1-0" d="M10,0 L20,0 L20,10 Z"/></g></svg>',
};

/** `fetch` stub answering with JSON bodies in order (the last one repeats). */
export function fetchResponses(...bodies: unknown[]) {
  let call = 0;
  return vi.fn(async () => {
    const body = bodies[Math.min(call, bodies.length - 1)];
    call += 1;
    return new Response(JSON.stringify(body), { status: 200 });
  });
}
