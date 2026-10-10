// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseSvg } from '../editor/model';
import {
  FRAGMENTS_STORAGE_KEY,
  cleanName,
  extractFragment,
  fragmentColors,
  fragmentDoc,
  fragmentSvg,
  libraryFile,
  mergeFragments,
  nextFragmentName,
  parseLibraryFile,
  readFragments,
  saveFragments,
  validFragments,
  type Fragment,
} from './fragments';

const doc = parseSvg(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<g data-palette-index="0" fill="#ffffff"><path id="bg" d="M0,0 H100 V100 H0 Z"/></g>' +
    '<g data-palette-index="1" fill="#ff0000">' +
    '<path id="a" d="M20,30 L40,30 L40,50 L20,50 Z"/>' +
    '<path id="b" d="M50,30 L60,30 L60,40 L50,40 Z" fill="#0000ff"/></g></svg>',
);

const fragment: Fragment = {
  id: 'x',
  name: 'Heart',
  width: 10,
  height: 10,
  shapes: [{ d: 'M0,0 L10,0 L10,10 Z', fill: '#ff0000' }],
  createdAt: '2026-01-01T00:00:00.000Z',
};

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => void (data[key] = value),
    removeItem: (key: string) => void delete data[key],
  };
}

describe('fragments', () => {
  it('extracts shapes with their colors, moved to the origin', () => {
    const now = new Date('2026-10-10T12:00:00Z');
    const result = extractFragment(doc, ['b', 'a'], 'Pair', now)!;

    expect(result).toMatchObject({
      name: 'Pair',
      width: 40,
      height: 20,
      createdAt: '2026-10-10T12:00:00.000Z',
    });
    // Document order is kept, own colors win over the group color.
    expect(result.shapes.map((shape) => shape.fill)).toEqual(['#ff0000', '#0000ff']);
    expect(result.shapes[0].d).toBe('M0,0h20v20h-20z');
    expect(extractFragment(doc, ['missing'], 'None')).toBeNull();
  });

  it('turns a fragment into a document with one group per color', () => {
    const pair = extractFragment(doc, ['a', 'b'], 'Pair')!;
    const fragmentDocument = fragmentDoc({
      ...pair,
      shapes: [...pair.shapes, { d: 'M0,0 L1,1 Z', fill: '#ff0000' }],
    });

    expect(fragmentDocument.groups.map((group) => [group.fill, group.shapes.length])).toEqual([
      ['#ff0000', 2],
      ['#0000ff', 1],
    ]);
    expect(fragmentColors(pair)).toEqual(['#ff0000', '#0000ff']);
    expect(fragmentSvg(fragment)).toContain('viewBox="0 0 10 10"');
  });

  it('names new fragments and cleans entered names', () => {
    expect(nextFragmentName([])).toBe('Fragment 1');
    expect(nextFragmentName([{ name: 'Fragment 2' }])).toBe('Fragment 3');
    expect(nextFragmentName([{ name: 'A' }, { name: 'Fragment 3' }])).toBe('Fragment 4');
    expect(cleanName('  Star  ', 'X')).toBe('Star');
    expect(cleanName('   ', 'X')).toBe('X');
    expect(cleanName('a'.repeat(100), 'X')).toHaveLength(60);
  });

  it('stores the library and skips invalid entries', () => {
    const storage = memoryStorage();

    expect(saveFragments(storage, [fragment])).toBe(true);
    expect(readFragments(storage)).toEqual([fragment]);
    expect(saveFragments(storage, [])).toBe(true);
    expect(storage.data[FRAGMENTS_STORAGE_KEY]).toBeUndefined();

    const broken = memoryStorage({ [FRAGMENTS_STORAGE_KEY]: '{not json' });
    expect(readFragments(broken)).toEqual([]);
    expect(readFragments(undefined)).toEqual([]);
    expect(validFragments([fragment, { ...fragment, shapes: [] }, { id: 1 }, null])).toEqual([
      fragment,
    ]);
    expect(validFragments([{ ...fragment, shapes: [{ d: 'M0,0', fill: 'red' }] }])).toEqual([]);
    expect(validFragments('nope')).toEqual([]);
  });

  it('reports a library that could not be stored', () => {
    const full = {
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
      removeItem: () => undefined,
    };

    expect(saveFragments(full, [fragment])).toBe(false);
    expect(saveFragments(undefined, [fragment])).toBe(false);
  });
});

describe('fragment library files', () => {
  const other: Fragment = { ...fragment, id: 'y', name: 'Star' };

  it('round-trips the library', () => {
    const text = libraryFile([fragment, other]);

    expect(JSON.parse(text)).toMatchObject({ format: 'vectorsnap-fragments', version: 1 });
    expect(parseLibraryFile(text)).toEqual([fragment, other]);
  });

  it('explains files that are not a library', () => {
    expect(() => parseLibraryFile('<svg/>')).toThrow('not a fragment library');
    expect(() => parseLibraryFile('{"fragments": []}')).toThrow('not a VectorSnap');
    expect(() => parseLibraryFile('null')).toThrow('not a VectorSnap');
    expect(() =>
      parseLibraryFile(JSON.stringify({ format: 'vectorsnap-fragments', fragments: [{}] })),
    ).toThrow('no valid fragments');
  });

  it('merges imports on top and skips fragments already in the library', () => {
    const merged = mergeFragments([fragment], [other, fragment, other]);

    expect(merged.added).toBe(1);
    expect(merged.fragments.map((item) => item.id)).toEqual(['y', 'x']);
    expect(mergeFragments(merged.fragments, [fragment]).added).toBe(0);
  });
});
