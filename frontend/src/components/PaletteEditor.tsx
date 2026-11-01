import { useState } from 'react';
import type { PaletteColor } from '../types/api';
import { EyeIcon } from './EyeIcon';
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
  /** The removed background (left out where it reaches the image border), or null. */
  background: number | null;
  onToggleTransparent: (index: number) => void;
  onSetBackground: (index: number | null) => void;
  onChange: (index: number, hex: string) => void;
  onReset: (index: number) => void;
  onResetAll: () => void;
  /** Name of a color (e.g. the filament it matches), shown next to its hex. */
  colorName?: (hex: string) => string | null;
  /** Palette index under the pointer or keyboard focus, shown on its own in the preview. */
  highlighted?: number | null;
  onHighlight?: (index: number | null) => void;
}

/**
 * The palette as one bar, each color as wide as its share of the image: how much of the
 * design (and of the print) a color makes up. Removed colors are hatched.
 */
function PaletteStrip({
  palette,
  overrides,
  transparent,
  onHighlight,
}: Pick<PaletteEditorProps, 'palette' | 'overrides' | 'transparent' | 'onHighlight'>) {
  const shown = palette.filter((color) => (color.coverage ?? 0) > 0);
  if (shown.length !== palette.length) return null;
  const label = shown
    .map((color) => `${overrides[color.index] ?? color.hex} ${(color.coverage! * 100).toFixed(1)}%`)
    .join(', ');
  return (
    <div className="palette-strip" role="img" aria-label={`Share of the image: ${label}`}>
      {shown.map((color) => {
        const hex = overrides[color.index] ?? color.hex;
        const removed = transparent.includes(color.index);
        return (
          <span
            key={color.index}
            className={removed ? 'removed' : undefined}
            style={{ flexGrow: color.coverage, background: removed ? undefined : hex }}
            title={`${hex}: ${(color.coverage! * 100).toFixed(1)}%${removed ? ' (removed)' : ''}`}
            onMouseEnter={() => onHighlight?.(color.index)}
            onMouseLeave={() => onHighlight?.(null)}
          />
        );
      })}
    </div>
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
  background,
  onToggleTransparent,
  onSetBackground,
  onChange,
  onReset,
  onResetAll,
  colorName,
  highlighted = null,
  onHighlight,
}: PaletteEditorProps) {
  // Drag a row onto another to merge: the dragged color takes the other's value.
  const [dragged, setDragged] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const hexOf = (index: number) =>
    overrides[index] ?? palette.find((color) => color.index === index)?.hex;
  const canDropOn = (index: number) =>
    dragged !== null &&
    dragged !== index &&
    !transparent.includes(index) &&
    hexOf(dragged) !== hexOf(index);
  const endDrag = () => {
    setDragged(null);
    setDropTarget(null);
  };
  const changed = Object.keys(overrides).length > 0;
  const lastVisible = transparent.length + 1 >= palette.length;
  const canRemoveBackground =
    backgroundIndex !== null &&
    background === null &&
    !transparent.includes(backgroundIndex) &&
    !lastVisible;
  const backgroundRemoved = background !== null && !transparent.includes(background);
  const backgroundHex =
    background === null
      ? null
      : (overrides[background] ?? palette.find((color) => color.index === background)?.hex);

  return (
    <div className="field">
      <div className="field__header">
        <span>Palette</span>
        <span className="field__links">
          {canRemoveBackground && (
            <button
              type="button"
              className="link"
              onClick={() => onSetBackground(backgroundIndex)}
              title="Leave out the color around the motif; the same color inside it stays"
            >
              Remove background
            </button>
          )}
          {backgroundRemoved && (
            <button type="button" className="link" onClick={() => onSetBackground(null)}>
              Restore background
            </button>
          )}
          <button type="button" className="link" onClick={onResetAll} disabled={!changed}>
            Reset all
          </button>
        </span>
      </div>
      {backgroundRemoved && (
        <p className="hint" role="status">
          Background removed: <code>{backgroundHex}</code> is left out where it reaches the image
          edge; the same color inside the design stays.
        </p>
      )}
      <PaletteStrip
        palette={palette}
        overrides={overrides}
        transparent={transparent}
        onHighlight={onHighlight}
      />
      <ul className="palette">
        {palette.map((color) => {
          const hex = overrides[color.index] ?? color.hex;
          const isChanged = color.index in overrides;
          const isLocked = locked.includes(color.hex.toLowerCase());
          const isRemoved = transparent.includes(color.index);
          return (
            <li
              key={color.index}
              className={
                [
                  isRemoved && 'removed',
                  highlighted === color.index && 'highlighted',
                  dragged === color.index && 'dragging',
                  dropTarget === color.index && 'drop-target',
                ]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
              draggable={!isRemoved}
              title={isRemoved ? undefined : 'Drag onto another color to merge them'}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', hex);
                setDragged(color.index);
              }}
              onDragOver={(event) => {
                if (!canDropOn(color.index)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDropTarget(color.index);
              }}
              onDragLeave={() =>
                setDropTarget((target) => (target === color.index ? null : target))
              }
              onDrop={(event) => {
                event.preventDefault();
                if (dragged !== null && canDropOn(color.index)) onChange(dragged, hex);
                endDrag();
              }}
              onDragEnd={endDrag}
              onMouseEnter={() => onHighlight?.(color.index)}
              onMouseLeave={() => onHighlight?.(null)}
              onFocus={() => onHighlight?.(color.index)}
              onBlur={() => onHighlight?.(null)}
            >
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
                      : 'Leave this color out of the SVG everywhere'
                }
                disabled={!isRemoved && lastVisible}
                onClick={() => onToggleTransparent(color.index)}
              >
                <EyeIcon crossed={isRemoved} />
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
      <p className="hint">
        Point at a color to see where it is in the image. Drag a color onto another (or give them
        the same value) to merge them; Reset undoes it.
      </p>
    </div>
  );
}
