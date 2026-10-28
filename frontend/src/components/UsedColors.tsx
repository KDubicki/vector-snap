import type { ColorGroup } from '../editor/model';

interface UsedColorsProps {
  groups: ColorGroup[];
  excluded: readonly number[];
  /** Palette index of a background kept from the image, labelled as such. */
  background: number | null;
  error: string | null;
  onChange: (excluded: number[]) => void;
}

/**
 * The colors a 2D craft export (cookie cutter, sticker, stencil, coloring page) uses;
 * the ones left out are sent as `exclude_colors`.
 */
export function UsedColors({ groups, excluded, background, error, onChange }: UsedColorsProps) {
  return (
    <fieldset className="used-colors">
      <legend>Colors to use</legend>
      <ul>
        {groups.map((group) => (
          <li key={group.paletteIndex}>
            <label>
              <input
                type="checkbox"
                checked={!excluded.includes(group.paletteIndex)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? excluded.filter((index) => index !== group.paletteIndex)
                      : [...excluded, group.paletteIndex],
                  )
                }
              />
              <span className="swatch" style={{ background: group.fill }} />
              <code>{group.fill}</code>
              {group.paletteIndex === background && <span className="hint">background</span>}
            </label>
          </li>
        ))}
      </ul>
      <span className="hint">
        Colors left out are not cut or printed: leave out the background, so the outline follows the
        design instead of the whole image.
      </span>
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </fieldset>
  );
}
