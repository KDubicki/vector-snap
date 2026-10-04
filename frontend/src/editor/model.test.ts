// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { findShape, parseSvg, shapeCount, shapeFill } from './model';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20" width="40" height="20">
  <g id="color-0" data-palette-index="0" fill="#FF0000">
    <path id="p-0-0" data-palette-index="0" d="M0,0 L20,0 L20,20 L0,20 Z"/>
    <path id="p-0-1" data-palette-index="0" d="M30,0 L40,0 L40,10 Z" fill="#00FF00"/>
  </g>
  <g id="color-2" data-palette-index="2" fill="#0000ff">
    <path id="p-2-0" data-palette-index="2" d="M20,0 L30,0 L30,20 L20,20 Z"/>
    <path d=""/>
  </g>
</svg>`;

describe('editor model', () => {
  it('parses groups, shapes and dimensions from the backend contract', () => {
    const doc = parseSvg(SVG);

    expect([doc.width, doc.height]).toEqual([40, 20]);
    expect(doc.groups.map((g) => [g.paletteIndex, g.fill, g.shapes.length])).toEqual([
      [0, '#ff0000', 2],
      [2, '#0000ff', 1],
    ]);
    expect(doc.groups[0].shapes[1]).toEqual({
      id: 'p-0-1',
      d: 'M30,0 L40,0 L40,10 Z',
      fill: '#00ff00',
    });
    expect(shapeCount(doc)).toBe(3);
  });

  it('falls back to width/height and generated ids', () => {
    const doc = parseSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="6"><g data-palette-index="1" fill="#111111"><path d="M0,0 L1,1 Z"/></g></svg>',
    );

    expect([doc.width, doc.height]).toEqual([8, 6]);
    expect(doc.groups[0].shapes[0].id).toBe('p-1-0');
  });

  it('rejects documents that are not SVG', () => {
    expect(() => parseSvg('<html></html>')).toThrow('Not an SVG document');
  });

  it('finds shapes and resolves their effective fill', () => {
    const doc = parseSvg(SVG);

    const own = findShape(doc, 'p-0-1');
    const inherited = findShape(doc, 'p-2-0');

    expect(own && shapeFill(own.group, own.shape)).toBe('#00ff00');
    expect(inherited && shapeFill(inherited.group, inherited.shape)).toBe('#0000ff');
    expect(findShape(doc, 'missing')).toBeNull();
  });
});
