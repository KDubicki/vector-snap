import { useState } from 'react';
import { useAppStore } from '../state/store';

const DEFAULT_MAX_AREA = 25;

/** Select specks and slivers left by tracing, to delete, recolor or move them at once. */
export function SmallShapesSelector() {
  const [maxArea, setMaxArea] = useState(DEFAULT_MAX_AREA);
  const valid = Number.isFinite(maxArea) && maxArea > 0;

  return (
    <div className="field small-shapes">
      <label htmlFor="small-shapes-area">Select shapes smaller than</label>
      <div className="small-shapes__row">
        <input
          id="small-shapes-area"
          type="number"
          min={1}
          step={1}
          value={Number.isFinite(maxArea) ? maxArea : ''}
          onChange={(event) => setMaxArea(event.target.valueAsNumber)}
        />
        <span className="hint">px²</span>
        <button
          type="button"
          className="secondary"
          aria-label="Select small shapes"
          disabled={!valid}
          onClick={() => useAppStore.getState().selectSmallerThan(maxArea)}
        >
          Select
        </button>
      </div>
      <p className="hint">
        Image pixels — 25 is a 5 × 5 px speck. Then delete, recolor or move them together.
      </p>
    </div>
  );
}
