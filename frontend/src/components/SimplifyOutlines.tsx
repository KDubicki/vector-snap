import { useState } from 'react';
import { useAppStore } from '../state/store';

const LEVELS = [
  { value: 0.5, label: 'Light', title: 'Outlines move at most 0.5 px' },
  { value: 1, label: 'Medium', title: 'Outlines move at most 1 px' },
  { value: 2, label: 'Strong', title: 'Outlines move at most 2 px' },
];
const DEFAULT_LEVEL = 1;

/** Fewer outline points for cutters, laser software and slicers (`POST /svg/simplify`). */
export function SimplifyOutlines() {
  const [level, setLevel] = useState(DEFAULT_LEVEL);
  const simplifying = useAppStore((s) => s.simplifying);
  const selected = useAppStore((s) => s.selection.length);
  const simplify = useAppStore((s) => s.simplifyOutlines);

  return (
    <div className="field simplify-outlines">
      <span>Simplify outlines</span>
      <div className="segmented" role="radiogroup" aria-label="Simplify level">
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
      <button
        type="button"
        className="secondary"
        disabled={simplifying}
        onClick={() => void simplify(level)}
      >
        {simplifying
          ? 'Simplifying…'
          : selected
            ? `Simplify ${selected === 1 ? 'the selected shape' : `${selected} selected shapes`}`
            : 'Simplify every shape'}
      </button>
      <p className="hint">
        Fewer points for cutters, laser software and slicers; holes stay. Simplified shapes become
        straight segments — Undo brings the curves back.
      </p>
    </div>
  );
}
