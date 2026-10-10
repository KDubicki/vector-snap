/**
 * Filaments the user can print with, for choosing the palette from real filament colors
 * (`algorithm: 'filaments'`, see docs/06-image-processing-pipeline.md#filaments-for-3d-printing).
 * A catalog of common PLA colors plus the user's own; stored per browser, and the page
 * works without storage. See docs/07-frontend.md.
 */
import { isHexColor } from './color';

export interface LibraryFilament {
  name: string;
  color: string;
}

export interface FilamentLibrary {
  /** Catalog and own filament colors that are available (lowercase hex). */
  owned: string[];
  /** Filaments added by the user. */
  custom: LibraryFilament[];
}

export const FILAMENT_LIBRARY_KEY = 'vectorsnap.filament-library';
export const MAX_CUSTOM_FILAMENTS = 40;

/**
 * Common PLA colors. Approximate: makers' shades differ, so users can add the exact
 * colors of their spools.
 */
export const COMMON_FILAMENTS: LibraryFilament[] = [
  { name: 'White', color: '#f7f7f5' },
  { name: 'Black', color: '#1b1b1b' },
  { name: 'Light gray', color: '#c6c8c9' },
  { name: 'Gray', color: '#8e9089' },
  { name: 'Dark gray', color: '#4a4d50' },
  { name: 'Red', color: '#c12e1f' },
  { name: 'Dark red', color: '#7f1d1d' },
  { name: 'Orange', color: '#ff6a13' },
  { name: 'Gold', color: '#d4a637' },
  { name: 'Yellow', color: '#f4d31a' },
  { name: 'Lime', color: '#bfd02b' },
  { name: 'Green', color: '#00ae42' },
  { name: 'Olive', color: '#6b7a2a' },
  { name: 'Dark green', color: '#2e6b3a' },
  { name: 'Cyan', color: '#00a3e0' },
  { name: 'Blue', color: '#0a5cb8' },
  { name: 'Navy', color: '#1f2a5a' },
  { name: 'Purple', color: '#6b3fa0' },
  { name: 'Magenta', color: '#e4007c' },
  { name: 'Pink', color: '#f5a3c0' },
  { name: 'Skin', color: '#f1c7a1' },
  { name: 'Beige', color: '#e8d3b0' },
  { name: 'Brown', color: '#7b4a2c' },
  { name: 'Dark brown', color: '#4a2f1d' },
];

export const DEFAULT_FILAMENT_LIBRARY: FilamentLibrary = {
  owned: COMMON_FILAMENTS.map((filament) => filament.color),
  custom: [],
};

/** Every filament of the library: the catalog, then the user's own. */
export function allFilaments(library: FilamentLibrary): LibraryFilament[] {
  return [...COMMON_FILAMENTS, ...library.custom];
}

/** Colors of the available filaments, without duplicates. */
export function ownedColors(library: FilamentLibrary): string[] {
  const known = new Set(allFilaments(library).map((filament) => filament.color));
  return [...new Set(library.owned)].filter((color) => known.has(color));
}

/** Name of the library filament with exactly this color, if any. */
export function filamentName(library: FilamentLibrary, color: string): string | null {
  const hex = color.toLowerCase();
  return allFilaments(library).find((filament) => filament.color === hex)?.name ?? null;
}

export function toggleOwned(library: FilamentLibrary, color: string): FilamentLibrary {
  const owned = library.owned.includes(color)
    ? library.owned.filter((item) => item !== color)
    : [...library.owned, color];
  return { ...library, owned };
}

/** Add an own filament (available right away); an existing color is just made available. */
export function addCustomFilament(
  library: FilamentLibrary,
  filament: LibraryFilament,
): FilamentLibrary {
  const color = filament.color.toLowerCase();
  const name = filament.name.trim() || color;
  const exists = allFilaments(library).some((item) => item.color === color);
  if (
    !isHexColor(color) ||
    (!exists && library.custom.length >= MAX_CUSTOM_FILAMENTS) ||
    (exists && library.owned.includes(color))
  ) {
    return library;
  }
  return {
    custom: exists ? library.custom : [...library.custom, { name, color }],
    owned: library.owned.includes(color) ? library.owned : [...library.owned, color],
  };
}

export function removeCustomFilament(library: FilamentLibrary, color: string): FilamentLibrary {
  return {
    custom: library.custom.filter((filament) => filament.color !== color),
    owned: library.owned.filter((item) => item !== color),
  };
}

/** The library in storage; missing or invalid data reads as the default library. */
export function readFilamentLibrary(
  storage: Pick<Storage, 'getItem'> | undefined,
): FilamentLibrary {
  try {
    const raw = storage?.getItem(FILAMENT_LIBRARY_KEY);
    if (!raw) return DEFAULT_FILAMENT_LIBRARY;
    const data = JSON.parse(raw) as Partial<FilamentLibrary>;
    const custom = Array.isArray(data.custom)
      ? data.custom.filter(
          (item): item is LibraryFilament =>
            typeof item?.name === 'string' && isHexColor(String(item?.color)),
        )
      : [];
    const owned = Array.isArray(data.owned)
      ? data.owned.filter((color): color is string => isHexColor(String(color)))
      : DEFAULT_FILAMENT_LIBRARY.owned;
    return {
      custom: custom.map((item) => ({ name: item.name, color: item.color.toLowerCase() })),
      owned: owned.map((color) => color.toLowerCase()),
    };
  } catch {
    return DEFAULT_FILAMENT_LIBRARY;
  }
}

export function saveFilamentLibrary(
  storage: Pick<Storage, 'setItem'> | undefined,
  library: FilamentLibrary,
): void {
  try {
    storage?.setItem(FILAMENT_LIBRARY_KEY, JSON.stringify(library));
  } catch {
    // Not remembered; the library still applies to this page.
  }
}
