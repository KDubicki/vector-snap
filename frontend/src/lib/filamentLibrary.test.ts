import { describe, expect, it } from 'vitest';
import {
  COMMON_FILAMENTS,
  DEFAULT_FILAMENT_LIBRARY,
  FILAMENT_LIBRARY_KEY,
  MAX_CUSTOM_FILAMENTS,
  addCustomFilament,
  allFilaments,
  filamentName,
  ownedColors,
  readFilamentLibrary,
  removeCustomFilament,
  saveFilamentLibrary,
  toggleOwned,
  type FilamentLibrary,
} from './filamentLibrary';

const empty: FilamentLibrary = { owned: [], custom: [] };

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => void (data[key] = value),
  };
}

describe('filament library', () => {
  it('offers every common color by default, with unique lowercase hex values', () => {
    const colors = COMMON_FILAMENTS.map((filament) => filament.color);

    expect(new Set(colors).size).toBe(colors.length);
    expect(colors.every((color) => /^#[0-9a-f]{6}$/.test(color))).toBe(true);
    expect(ownedColors(DEFAULT_FILAMENT_LIBRARY)).toEqual(colors);
  });

  it('toggles filaments and names colors', () => {
    const white = COMMON_FILAMENTS[0].color;
    const without = toggleOwned(DEFAULT_FILAMENT_LIBRARY, white);

    expect(ownedColors(without)).not.toContain(white);
    expect(ownedColors(toggleOwned(without, white))).toContain(white);
    expect(filamentName(DEFAULT_FILAMENT_LIBRARY, white.toUpperCase())).toBe('White');
    expect(filamentName(DEFAULT_FILAMENT_LIBRARY, '#123456')).toBeNull();
  });

  it('adds own filaments, available right away, and removes them', () => {
    const added = addCustomFilament(empty, { name: ' Matte olive ', color: '#55AA00' });

    expect(added.custom).toEqual([{ name: 'Matte olive', color: '#55aa00' }]);
    expect(ownedColors(added)).toEqual(['#55aa00']);
    expect(allFilaments(added).at(-1)).toEqual({ name: 'Matte olive', color: '#55aa00' });
    // A known color is only made available again, not added twice.
    expect(addCustomFilament(added, { name: 'Again', color: '#55aa00' })).toBe(added);
    const catalog = addCustomFilament(empty, { name: '', color: COMMON_FILAMENTS[1].color });
    expect(catalog).toEqual({ custom: [], owned: [COMMON_FILAMENTS[1].color] });
    expect(addCustomFilament(empty, { name: 'X', color: 'red' })).toBe(empty);
    expect(addCustomFilament(empty, { name: '', color: '#010203' }).custom[0].name).toBe('#010203');

    expect(removeCustomFilament(added, '#55aa00')).toEqual(empty);
  });

  it('limits the number of own filaments', () => {
    let library = empty;
    for (let i = 0; i < MAX_CUSTOM_FILAMENTS + 2; i += 1) {
      library = addCustomFilament(library, {
        name: `F${i}`,
        color: `#0000${i.toString(16).padStart(2, '0')}`,
      });
    }

    expect(library.custom).toHaveLength(MAX_CUSTOM_FILAMENTS);
  });

  it('ignores owned colors that are not in the library', () => {
    expect(ownedColors({ owned: ['#abcdef', '#abcdef'], custom: [] })).toEqual([]);
  });

  it('stores the library and reads damaged data as the default', () => {
    const storage = memoryStorage();
    const library = addCustomFilament(empty, { name: 'Mine', color: '#112233' });

    saveFilamentLibrary(storage, library);
    expect(readFilamentLibrary(storage)).toEqual(library);
    expect(readFilamentLibrary(undefined)).toBe(DEFAULT_FILAMENT_LIBRARY);
    expect(readFilamentLibrary(memoryStorage({ [FILAMENT_LIBRARY_KEY]: '{oops' }))).toBe(
      DEFAULT_FILAMENT_LIBRARY,
    );
    const partial = memoryStorage({
      [FILAMENT_LIBRARY_KEY]: JSON.stringify({
        owned: ['#AABBCC', 'red'],
        custom: [{ name: 'A', color: '#AABBCC' }, { name: 1, color: '#000000' }, null],
      }),
    });
    expect(readFilamentLibrary(partial)).toEqual({
      owned: ['#aabbcc'],
      custom: [{ name: 'A', color: '#aabbcc' }],
    });
    expect(
      readFilamentLibrary(memoryStorage({ [FILAMENT_LIBRARY_KEY]: '{"custom": "x"}' })).owned,
    ).toEqual(DEFAULT_FILAMENT_LIBRARY.owned);
    const full = {
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => saveFilamentLibrary(full, library)).not.toThrow();
  });
});
