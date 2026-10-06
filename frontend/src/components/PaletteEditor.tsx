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
  onChange: (index: number, hex: string) => void;
  onReset: (index: number) => void;
  onResetAll: () => void;
}

export function PaletteEditor({
  palette,
  overrides,
  locked,
  canLock,
  onLock,
  onUnlock,
  onChange,
  onReset,
  onResetAll,
}: PaletteEditorProps) {
  const changed = Object.keys(overrides).length > 0;

  return (
    <div className="field">
      <div className="field__header">
        <span>Palette</span>
        <button type="button" className="link" onClick={onResetAll} disabled={!changed}>
          Reset all
        </button>
      </div>
      <ul className="palette">
        {palette.map((color) => {
          const hex = overrides[color.index] ?? color.hex;
          const isChanged = color.index in overrides;
          const isLocked = locked.includes(color.hex.toLowerCase());
          return (
            <li key={color.index}>
              <input
                type="color"
                value={hex}
                aria-label={`Palette color ${color.index + 1}: ${hex}`}
                onChange={(event) => onChange(color.index, event.target.value)}
              />
              <code>{hex}</code>
              {color.coverage !== undefined && (
                <span className="coverage" title="Share of the image">
                  <span style={{ width: `${Math.max(color.coverage * 100, 1)}%` }} />
                  {(color.coverage * 100).toFixed(1)}%
                </span>
              )}
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
