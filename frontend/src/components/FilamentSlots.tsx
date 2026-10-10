import { MAX_FILAMENTS, typicalTd } from '../lib/printPlan';
import type { Filament } from '../lib/mixing';

interface FilamentSlotsProps {
  filaments: Filament[];
  error?: string;
  onChange: (filaments: Filament[]) => void;
  /** Replace the filaments by colors suggested from the design. */
  onSuggest: () => void;
}

const TD_TABLE =
  'https://help.prusa3d.com/article/hueforge-filament-transparency-values-and-hexcodes_762314';

/** The loaded filaments for mixed colors: color and transmission distance (TD). */
export function FilamentSlots({ filaments, error, onChange, onSuggest }: FilamentSlotsProps) {
  const set = (index: number, change: Partial<Filament>) =>
    onChange(filaments.map((filament, i) => (i === index ? { ...filament, ...change } : filament)));

  return (
    <fieldset className="filament-slots">
      <legend>Loaded filaments</legend>
      <ol>
        {filaments.map((filament, index) => (
          <li key={index}>
            <span className="filament-slots__slot">{index + 1}</span>
            <input
              type="color"
              value={filament.color}
              aria-label={`Filament ${index + 1} color`}
              onChange={(event) => set(index, { color: event.target.value.toLowerCase() })}
            />
            <code>{filament.color}</code>
            <label className="filament-slots__td">
              TD
              <input
                type="number"
                min={0.1}
                max={100}
                step={0.1}
                value={Number.isFinite(filament.td) ? filament.td : ''}
                aria-label={`Filament ${index + 1} transmission distance (mm)`}
                onChange={(event) => set(index, { td: event.target.valueAsNumber })}
              />
            </label>
            <button
              type="button"
              className="link"
              aria-label={`Remove filament ${index + 1}`}
              disabled={filaments.length === 1}
              onClick={() => onChange(filaments.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </li>
        ))}
      </ol>
      <div className="filament-slots__actions">
        <button
          type="button"
          className="link"
          disabled={filaments.length >= MAX_FILAMENTS}
          onClick={() => onChange([...filaments, { color: '#808080', td: typicalTd('#808080') }])}
        >
          Add filament
        </button>
        <button type="button" className="link" onClick={onSuggest}>
          Suggest from the design
        </button>
      </div>
      {error && <span className="field-error">{error}</span>}
      <span className="hint">
        Set the colors of the filaments you will load (slot 1 also prints the base plate — white
        mixes best). TD is how translucent a filament is, in mm: see the maker or the{' '}
        <a href={TD_TABLE} target="_blank" rel="noreferrer">
          HueForge TD table
        </a>
        ; about 0.5 for black, 1–2 for colors, 3+ for white.
      </span>
    </fieldset>
  );
}
