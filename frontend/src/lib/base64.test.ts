import { describe, expect, it } from 'vitest';
import { base64ToBlob, dataUrl } from './base64';

describe('base64 helpers', () => {
  it('decodes base64 into a typed blob', async () => {
    const blob = base64ToBlob(btoa('hello'), 'text/plain');

    expect(blob.type).toBe('text/plain');
    expect(await blob.text()).toBe('hello');
  });

  it('builds data urls', () => {
    expect(dataUrl('AAA', 'image/png')).toBe('data:image/png;base64,AAA');
  });
});
