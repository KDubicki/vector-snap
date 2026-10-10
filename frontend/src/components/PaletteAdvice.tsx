import type { LibraryFilament } from '../lib/filamentLibrary';
import {
  NEAR_DUPLICATE_DELTA_E,
  TINY_COVERAGE,
  mergeOverrides,
  nearestFilaments,
  similarPairs,
  tinyColors,
  type MergeSuggestion,
  type PaletteEntry,
} from '../lib/paletteAdvice';

interface PaletteAdviceProps {
  /** Visible palette colors with their final hex and coverage. */
  entries: PaletteEntry[];
  /** Available filaments to snap to; empty hides the action. */
  filaments: LibraryFilament[];
  onOverride: (overrides: Record<number, string>) => void;
}

const percent = (coverage: number) => `${(coverage * 100).toFixed(1)}%`;

function Swatch({ entry }: { entry: PaletteEntry }) {
  return (
    <span className="palette-advice__color">
      <span className="swatch" style={{ background: entry.hex }} />
      <code>{entry.hex}</code>
      <span className="hint">{percent(entry.coverage)}</span>
    </span>
  );
}

/** Compact relation between two colors, spelled out for screen readers and on hover. */
function Relation({ label, symbol }: { label: string; symbol: string }) {
  return (
    <span className="palette-advice__relation" title={label}>
      <span aria-hidden="true">{symbol}</span>
      <span className="visually-hidden">{label}</span>
    </span>
  );
}

/** 3D printing tips for the palette: merge near-duplicates and tiny colors, use filaments. */
export function PaletteAdvice({ entries, filaments, onOverride }: PaletteAdviceProps) {
  const pairs = similarPairs(entries);
  const tiny = tinyColors(entries).filter(
    (item) => !pairs.some((pair) => pair.merge.hex === item.merge.hex),
  );
  const snap = nearestFilaments(entries, filaments);
  const snapped = new Set([...snap.values()].map(({ filament }) => filament.color));
  const alreadyFilaments = [...snap.entries()].every(
    ([index, { filament }]) =>
      entries.find((entry) => entry.index === index)?.hex === filament.color,
  );
  const merge = (suggestion: MergeSuggestion) => onOverride(mergeOverrides(entries, suggestion));

  return (
    <div className="field palette-advice">
      <span>3D printing tips</span>
      {pairs.length === 0 && tiny.length === 0 && (
        <p className="hint">No near-duplicate or tiny colors: every color earns its filament.</p>
      )}
      {pairs.length > 0 && (
        <>
          <p className="hint">Similar colors — each one takes a filament slot:</p>
          <ul aria-label="Similar colors">
            {pairs.map((pair) => (
              <li key={pair.merge.hex}>
                <Swatch entry={pair.merge} />
                <Relation
                  label={pair.delta < NEAR_DUPLICATE_DELTA_E ? 'nearly identical to' : 'similar to'}
                  symbol={pair.delta < NEAR_DUPLICATE_DELTA_E ? '≈≈' : '≈'}
                />
                <Swatch entry={pair.keep} />
                <button
                  type="button"
                  className="link"
                  aria-label={`Merge ${pair.merge.hex} into ${pair.keep.hex}`}
                  onClick={() => merge(pair)}
                >
                  Merge
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {tiny.length > 0 && (
        <>
          <p className="hint">
            Tiny areas (under {percent(TINY_COVERAGE)}) rarely justify a filament change:
          </p>
          <ul aria-label="Tiny colors">
            {tiny.map((item) => (
              <li key={item.merge.hex}>
                <Swatch entry={item.merge} />
                <Relation label="nearest color" symbol="→" />
                <Swatch entry={item.keep} />
                <button
                  type="button"
                  className="link"
                  aria-label={`Merge ${item.merge.hex} into ${item.keep.hex}`}
                  onClick={() => merge(item)}
                >
                  Merge
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {snap.size > 0 && !alreadyFilaments && (
        <div className="palette-advice__snap">
          <button
            type="button"
            className="secondary"
            onClick={() =>
              onOverride(
                Object.fromEntries(
                  [...snap].map(([index, { filament }]) => [index, filament.color]),
                ),
              )
            }
          >
            Use my filaments
          </button>
          <span className="hint">
            Replaces each color by the nearest available filament — {[...snapped].length}{' '}
            {snapped.size === 1 ? 'filament' : 'filaments'}:{' '}
            {[...new Set([...snap.values()].map(({ filament }) => filament.name))].join(', ')}
          </span>
        </div>
      )}
    </div>
  );
}
