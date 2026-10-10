import { useState, type FormEvent } from 'react';
import {
  COMMON_FILAMENTS,
  addCustomFilament,
  allFilaments,
  ownedColors,
  removeCustomFilament,
  toggleOwned,
  type FilamentLibrary,
} from '../lib/filamentLibrary';

interface FilamentLibraryPanelProps {
  library: FilamentLibrary;
  /** Most filaments the palette may use (the color count). */
  maxColors: number;
  onChange: (library: FilamentLibrary) => void;
}

/** The filaments the palette is chosen from: common colors and the user's own spools. */
export function FilamentLibraryPanel({ library, maxColors, onChange }: FilamentLibraryPanelProps) {
  const [color, setColor] = useState('#808080');
  const [name, setName] = useState('');
  const available = ownedColors(library);
  const custom = new Set(library.custom.map((filament) => filament.color));

  const add = (event: FormEvent) => {
    event.preventDefault();
    onChange(addCustomFilament(library, { name, color }));
    setName('');
  };

  return (
    <div className="field filament-library">
      <div className="field__header">
        <span>Available filaments</span>
        <span className="field__links">
          <button
            type="button"
            className="link"
            onClick={() =>
              onChange({ ...library, owned: allFilaments(library).map((item) => item.color) })
            }
          >
            All
          </button>
          <button
            type="button"
            className="link"
            onClick={() => onChange({ ...library, owned: [] })}
          >
            None
          </button>
        </span>
      </div>
      <p className="hint" role="status">
        {available.length} available · up to {Math.min(maxColors, available.length)} of them are
        used, only those this image needs
      </p>
      <ul className="filament-library__list" aria-label="Filaments">
        {allFilaments(library).map((filament) => {
          const owned = library.owned.includes(filament.color);
          return (
            <li key={filament.color}>
              <button
                type="button"
                className="filament-chip"
                aria-pressed={owned}
                title={`${filament.name} (${filament.color})`}
                onClick={() => onChange(toggleOwned(library, filament.color))}
              >
                <span className="swatch" style={{ background: filament.color }} />
                {filament.name}
              </button>
              {custom.has(filament.color) && (
                <button
                  type="button"
                  className="link filament-chip__remove"
                  aria-label={`Remove ${filament.name}`}
                  onClick={() => onChange(removeCustomFilament(library, filament.color))}
                >
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <form className="filament-library__add" onSubmit={add}>
        <input
          type="color"
          value={color}
          aria-label="Your filament color"
          onChange={(event) => setColor(event.target.value)}
        />
        <input
          type="text"
          value={name}
          maxLength={40}
          placeholder="Name, e.g. Matte olive"
          aria-label="Your filament name"
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" className="secondary">
          Add
        </button>
      </form>
      <span className="hint">
        Untick colors you do not have and add your spools&apos; exact colors — the{' '}
        {COMMON_FILAMENTS.length} common colors are approximate.
      </span>
    </div>
  );
}
