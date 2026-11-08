// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { gzip } from '../test/fixtures';
import { importNotice, isOwnSvg, isSvgFile, pastedSvg, unpackSvg } from './openSvg';

const NS = 'xmlns="http://www.w3.org/2000/svg"';

describe('opening SVG files', () => {
  it('recognizes an SVG by its media type, or its extension without one', () => {
    expect(isSvgFile(new File(['x'], 'logo.svg', { type: 'image/svg+xml' }))).toBe(true);
    expect(isSvgFile(new File(['x'], 'LOGO.SVG', { type: '' }))).toBe(true);
    expect(isSvgFile(new File(['x'], 'logo.svg', { type: 'image/png' }))).toBe(false);
    expect(isSvgFile(new File(['x'], 'logo.png', { type: '' }))).toBe(false);
    // Compressed: the SVG type, a gzip type or none, as the system has it.
    expect(isSvgFile(new File(['x'], 'logo.svgz', { type: 'image/svg+xml' }))).toBe(true);
    expect(isSvgFile(new File(['x'], 'logo.SVGZ', { type: 'application/gzip' }))).toBe(true);
    expect(isSvgFile(new File(['x'], 'logo.svgz', { type: '' }))).toBe(true);
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

  it('unpacks a compressed SVG and leaves any other file as it is', async () => {
    const svg = `<svg ${NS} viewBox="0 0 10 10"><rect width="5" height="5"/></svg>`;
    const packed = new File([await gzip(svg)], 'logo.svgz', { type: 'image/svg+xml' });

    const unpacked = await unpackSvg(packed);

    expect(unpacked.name).toBe('logo.svg');
    expect(unpacked.type).toBe('image/svg+xml');
    expect(await unpacked.text()).toBe(svg);
    const plain = new File([svg], 'logo.svg', { type: 'image/svg+xml' });
    expect(await unpackSvg(plain)).toBe(plain);
  });

  it('says when a compressed SVG cannot be unpacked', async () => {
    const broken = new File([new Uint8Array([0x1f, 0x8b, 1, 2, 3])], 'logo.svgz');

    await expect(unpackSvg(broken)).rejects.toThrow(
      'logo.svgz is compressed (.svgz) but could not be unpacked.',
    );
  });

  it('takes pasted SVG code, and no other text', async () => {
    const figma = `<svg width="24" height="24" ${NS}><path d="M0 0h24v24H0z"/></svg>\n`;
    const pasted = pastedSvg(figma);
    expect(pasted?.name).toBe('pasted.svg');
    expect(pasted?.type).toBe('image/svg+xml');
    expect(await pasted?.text()).toBe(figma.trim());
    const inkscape = `<?xml version="1.0"?>\n<!-- Created with Inkscape -->\n<svg ${NS}/>`;
    expect(pastedSvg(inkscape)).not.toBeNull();
    expect(pastedSvg('https://example.com/logo.svg')).toBeNull();
    expect(pastedSvg('<p>Hello</p><svg/>')).toBeNull();
    expect(pastedSvg('')).toBeNull();
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
