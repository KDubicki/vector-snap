import { useMemo, useState } from 'react';
import { findSimilarColors } from '../editor/similarColors';
import { SIMILAR_LEVELS } from '../lib/color';
import { useAppStore } from '../state/store';

const LEVELS = SIMILAR_LEVELS.filter((level) => level.value > 0);
const DEFAULT_LEVEL = 2;

/** Colors of the document's palette groups; changing one recolors the group (FR-34). */
export function EditorPalettePanel() {
  const editor = useAppStore((s) => s.editor);
  const recolorGroup = useAppStore((s) => s.recolorGroup);
  const select = useAppStore((s) => s.select);
  const mergeSimilarColors = useAppStore((s) => s.mergeSimilarColors);
  const [level, setLevel] = useState(DEFAULT_LEVEL);
  const similar = useMemo(() => editor && findSimilarColors(editor, level), [editor, level]);

  if (!editor || !similar) return null;
  const count = similar.groups.length + similar.shapes.length;

  return (
    <>
      <div className="field">
        <span>Color groups</span>
        <ul className="palette">
          {editor.groups.map((group) => (
            <li key={group.paletteIndex}>
              <input
                type="color"
                value={group.fill}
                aria-label={`Group ${group.paletteIndex + 1} color: ${group.fill}`}
                onChange={(event) => recolorGroup(group.paletteIndex, event.target.value)}
              />
              <code>{group.fill}</code>
              <span className="hint">
                {group.shapes.length} {group.shapes.length === 1 ? 'shape' : 'shapes'}
              </span>
              <button
                type="button"
                className="link"
                aria-label={`Select all shapes of group ${group.paletteIndex + 1}`}
                onClick={() => {
                  select(null);
                  group.shapes.forEach((shape) => select(shape.id, true));
                }}
              >
                Select
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="field merged-colors">
        <span>Similar colors</span>
        <div className="segmented" role="radiogroup" aria-label="Similar colors">
          {LEVELS.map(({ value, label, title }) => (
            <button
              key={value}
              type="button"
              role="radio"
              title={title}
              aria-checked={level === value}
              className={level === value ? 'active' : ''}
              onClick={() => setLevel(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {count ? (
          <>
            <ul aria-label="Colors that look the same">
              {similar.groups.map((group) => (
                <li key={group.paletteIndex}>
                  <span className="merged-colors__swatch" style={{ background: group.fill }} />
                  <code>{group.fill}</code>→
                  <span className="merged-colors__swatch" style={{ background: group.intoFill }} />
                  <code>{group.intoFill}</code>
                  <span className="hint">ΔE {group.deltaE.toFixed(1)}</span>
                </li>
              ))}
            </ul>
            {similar.shapes.length > 0 && (
              <span className="hint">
                {similar.shapes.length === 1 ? '1 shape' : `${similar.shapes.length} shapes`} with
                an own color like its group&apos;s will follow the group.
              </span>
            )}
            <button type="button" className="secondary" onClick={() => mergeSimilarColors(level)}>
              Merge {count === 1 ? '1 similar color' : `${count} similar colors`}
            </button>
          </>
        ) : (
          <span className="hint">No colors look alike at this level.</span>
        )}
        <span className="hint">
          Colors this close print as filaments nobody can tell apart (CIEDE2000: under 1 invisible,
          1–2 only side by side). The color covering less joins the other one.
        </span>
      </div>
    </>
  );
}
