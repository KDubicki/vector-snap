// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { GENERATOR, serializeSvg } from './export';
import { parseSvg, type EditorDoc } from './model';

const doc: EditorDoc = {
  width: 40,
  height: 20,
  groups: [
    {
      paletteIndex: 0,
      fill: '#ff0000',
      shapes: [
        { id: 'p-0-0', d: 'M0,0 L20,0 L20,20 Z' },
        { id: 'p-0-1.a', d: 'M20,0 L40,0 L40,20 Z M25,5 L35,5 L35,15 Z', fill: '#00ff00' },
      ],
    },
    { paletteIndex: 3, fill: '#0000ff', shapes: [{ id: 'p-3-0', d: 'M0,20 L40,20 Z' }] },
  ],
};

describe('serializeSvg', () => {
  it('follows the SVG output contract', () => {
    const svg = serializeSvg(doc);

    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20" width="40" height="20"' +
        ` data-generator="${GENERATOR}">` +
        '<g id="color-0" data-palette-index="0" fill="#ff0000">' +
        '<path id="p-0-0" data-palette-index="0" d="M0,0 L20,0 L20,20 Z"/>' +
        '<path id="p-0-1.a" data-palette-index="0" d="M20,0 L40,0 L40,20 Z M25,5 L35,5 L35,15 Z" fill="#00ff00"/>' +
        '</g>' +
        '<g id="color-3" data-palette-index="3" fill="#0000ff">' +
        '<path id="p-3-0" data-palette-index="3" d="M0,20 L40,20 Z"/>' +
        '</g></svg>',
    );
  });

  it('round-trips through the parser', () => {
    expect(parseSvg(serializeSvg(doc))).toEqual(doc);
  });

  it('escapes attribute values and skips empty groups', () => {
    const svg = serializeSvg({
      width: 1,
      height: 1,
      groups: [
        { paletteIndex: 0, fill: '#000000', shapes: [{ id: 'a"<b>&', d: 'M0,0 Z' }] },
        { paletteIndex: 1, fill: '#ffffff', shapes: [] },
      ],
    });

    expect(svg).toContain('id="a&quot;&lt;b&gt;&amp;"');
    expect(svg).not.toContain('color-1');
    expect(parseSvg(svg).groups[0].shapes[0].id).toBe('a"<b>&');
  });
});
