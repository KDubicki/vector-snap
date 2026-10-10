import type { PaletteColor } from '../types/api';
import { LockIcon } from './LockedColors';

interface PaletteEditorProps {
  palette: PaletteColor[];
  overrides: Record<number, string>;
  /** Locked colors; a row is locked when its quantized color is one of them. */
  locked: string[];
  /** Whether another color can be locked (the palette has a free slot). */
  canLock: boolean;
  onLock: (hex: string) => void;
  onUnlock: (hex: string) => void;
  /** Palette indices left out of the SVG. */
  transparent: number[];
  /** Palette index the backend detected as background, if any. */
  backgroundIndex: number | null;
  onToggleTransparent: (index: number) => void;
  onChange: (index: number, hex: string) => void;
  onReset: (index: number) => void;
  onResetAll: () => void;
  /** Name of a color (e.g. the filament it matches), shown next to its hex. */
  colorName?: (hex: string) => string | null;
}

function RemoveIcon({ removed }: { removed: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
      {removed && (
        <path
          d="M2.5 13.5 13.5 2.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export function PaletteEditor({
  palette,
  overrides,
  locked,
  canLock,
  onLock,
  onUnlock,
  transparent,
  backgroundIndex,
  onToggleTransparent,
  onChange,
  onReset,
  onResetAll,
  colorName,
}: PaletteEditorProps) {
  const changed = Object.keys(overrides).length > 0;
  const lastVisible = transparent.length + 1 >= palette.length;
  const canRemoveBackground =
    backgroundIndex !== null && !transparent.includes(backgroundIndex) && !lastVisible;

  return (
    <div className="field">
      <div className="field__header">
        <span>Palette</span>
        <span className="field__links">
          {canRemoveBackground && (
            <button
              type="button"
              className="link"
              onClick={() => onToggleTransparent(backgroundIndex)}
              title="Leave out the color that fills the image border"
            >
              Remove background
            </button>
          )}
          <button type="button" className="link" onClick={onResetAll} disabled={!changed}>
            Reset all
          </button>
        </span>
      </div>
      <ul className="palette">
        {palette.map((color) => {
          const hex = overrides[color.index] ?? color.hex;
          const isChanged = color.index in overrides;
          const isLocked = locked.includes(color.hex.toLowerCase());
          const isRemoved = transparent.includes(color.index);
          return (
            <li key={color.index} className={isRemoved ? 'removed' : undefined}>
              <input
                type="color"
                value={hex}
                aria-label={`Palette color ${color.index + 1}: ${hex}`}
                onChange={(event) => onChange(color.index, event.target.value)}
              />
              <span className="palette__hex">
                <code>{hex}</code>
                {colorName?.(hex) && <small>{colorName(hex)}</small>}
              </span>
              {color.coverage !== undefined && (
                <span className="coverage" title="Share of the image">
                  <span style={{ width: `${Math.max(color.coverage * 100, 1)}%` }} />
                  {(color.coverage * 100).toFixed(1)}%
                </span>
              )}
              <button
                type="button"
                className={`icon-toggle${isRemoved ? ' active' : ''}`}
                aria-pressed={isRemoved}
                aria-label={`${isRemoved ? 'Restore' : 'Remove'} ${color.hex}`}
                title={
                  isRemoved
                    ? 'Removed: left out of the SVG (transparent)'
                    : lastVisible
                      ? 'At least one color has to stay'
                      : 'Leave this color out of the SVG (e.g. the background)'
                }
                disabled={!isRemoved && lastVisible}
                onClick={() => onToggleTransparent(color.index)}
              >
                <RemoveIcon removed={isRemoved} />
              </button>
              <button
                type="button"
                className={`icon-toggle${isLocked ? ' active' : ''}`}
                aria-pressed={isLocked}
                aria-label={`${isLocked ? 'Unlock' : 'Lock'} ${color.hex}`}
                title={
                  isLocked
                    ? 'Locked: kept exactly when colors are reduced again'
                    : canLock
                      ? 'Lock this color so it stays exactly in the palette'
                      : 'Every palette slot is locked'
                }
                disabled={!isLocked && !canLock}
                onClick={() => (isLocked ? onUnlock(color.hex) : onLock(hex))}
              >
                <LockIcon locked={isLocked} />
              </button>
              {isChanged && (
                <button
                  type="button"
                  className="link"
                  onClick={() => onReset(color.index)}
                  title={`Restore ${color.hex}`}
                >
                  Reset
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="hint">Tip: give two colors the same value to merge them.</p>
    </div>
  );
}
