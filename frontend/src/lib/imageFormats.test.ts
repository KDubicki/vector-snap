import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMATS, acceptAttribute, formatList, isSupportedImage } from './imageFormats';

describe('image formats', () => {
  it('names the formats for people', () => {
    expect(formatList(DEFAULT_FORMATS)).toBe('JPEG, PNG, WebP or AVIF');
    expect(formatList(DEFAULT_FORMATS, 'and')).toBe('JPEG, PNG, WebP and AVIF');
    expect(formatList(['image/png'])).toBe('PNG');
    // A format a newer backend adds is named by its media type.
    expect(formatList(['image/png', 'image/heic'])).toBe('PNG or HEIC');
  });

  it('offers media types and extensions to the file picker', () => {
    expect(acceptAttribute(['image/jpeg', 'image/avif'])).toBe(
      'image/jpeg,image/avif,.jpg,.jpeg,.avif',
    );
  });

  it('judges a file by its media type, or by its extension when it has none', () => {
    const file = (name: string, type: string) => new File(['x'], name, { type });

    expect(isSupportedImage(file('a.webp', 'image/webp'), DEFAULT_FORMATS)).toBe(true);
    expect(isSupportedImage(file('a.avif', 'image/avif'), DEFAULT_FORMATS)).toBe(true);
    expect(isSupportedImage(file('a.gif', 'image/gif'), DEFAULT_FORMATS)).toBe(false);
    expect(isSupportedImage(file('photo.AVIF', ''), DEFAULT_FORMATS)).toBe(true);
    expect(isSupportedImage(file('notes.txt', ''), DEFAULT_FORMATS)).toBe(false);
    // The media type decides when there is one: a GIF named .png is not taken.
    expect(isSupportedImage(file('a.png', 'image/gif'), DEFAULT_FORMATS)).toBe(false);
    expect(isSupportedImage(file('a.webp', 'image/webp'), ['image/jpeg', 'image/png'])).toBe(false);
  });
});
