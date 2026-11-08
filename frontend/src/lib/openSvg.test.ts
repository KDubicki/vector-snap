// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { importNotice, isOwnSvg, isSvgFile } from './openSvg';

const NS = 'xmlns="http://www.w3.org/2000/svg"';

describe('opening SVG files', () => {
  it('recognizes an SVG by its media type, or its extension without one', () => {
    expect(isSvgFile(new File(['x'], 'logo.svg', { type: 'image/svg+xml' }))).toBe(true);
    expect(isSvgFile(new File(['x'], 'LOGO.SVG', { type: '' }))).toBe(true);
    expect(isSvgFile(new File(['x'], 'logo.svg', { type: 'image/png' }))).toBe(false);
    expect(isSvgFile(new File(['x'], 'logo.png', { type: '' }))).toBe(false);
  });

  it('opens VectorSnap designs as they are, everything else through the import', () => {
    const layers = '<g data-palette-index="0" fill="#000"><path d="M0 0h1v1z"/></g>';

    expect(isOwnSvg(`<svg ${NS} data-generator="vectorsnap/0.1.0">${layers}</svg>`)).toBe(true);
    expect(isOwnSvg(`<svg ${NS} data-generator="vectorsnap-editor">${layers}</svg>`)).toBe(true);
    // A sticker carries the mark but no color layers; Inkscape writes neither.
    expect(isOwnSvg(`<svg ${NS} data-generator="vectorsnap/0.1.0"><path d="M0 0"/></svg>`)).toBe(
      false,
    );
    expect(isOwnSvg(`<svg ${NS} width="210mm">${layers}</svg>`)).toBe(false);
    expect(isOwnSvg('not xml')).toBe(false);
  });

  it('says what the import left out or changed', () => {
    expect(importNotice('logo.svg', {})).toBeNull();
    expect(importNotice('logo.svg', { text: 2, unfilled: 1, gradients: 1 })).toBe(
      'logo.svg was opened as color areas: left out 2 texts, 1 unfilled shape; ' +
        'filled 1 gradient with its average color.',
    );
    expect(importNotice('icon.svg', { images: 1, gradients: 3 })).toBe(
      'icon.svg was opened as color areas: left out 1 embedded image; ' +
        'filled 3 gradients with their average color.',
    );
  });
});
