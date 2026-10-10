import { parseSvg, type EditorDoc } from '../editor/model';

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
