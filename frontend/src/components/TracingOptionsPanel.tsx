import type { Stacking, TracingMode, TracingOptions } from '../types/api';

interface TracingOptionsPanelProps {
  options: TracingOptions;
  onChange: (options: Partial<TracingOptions>) => void;
}

export function TracingOptionsPanel({ options, onChange }: TracingOptionsPanelProps) {
  return (
    <details className="field">
      <summary>Tracing options</summary>
      <div className="options">
        <label>
          Curves
          <select
            value={options.mode}
            onChange={(event) => onChange({ mode: event.target.value as TracingMode })}
          >
            <option value="spline">Smooth (spline)</option>
            <option value="polygon">Straight (polygon)</option>
          </select>
        </label>
        <label>
          Shapes
          <select
            value={options.stacking}
            onChange={(event) => onChange({ stacking: event.target.value as Stacking })}
          >
            <option value="cutout">Cutout — no overlaps (best for editing)</option>
            <option value="stacked">Stacked — no seams between colors</option>
          </select>
        </label>
        <label>
          Remove specks smaller than (px)
          <input
            type="number"
            min={0}
            max={128}
            value={options.filter_speckle}
            onChange={(event) => onChange({ filter_speckle: Number(event.target.value) })}
          />
        </label>
        <label>
          Corner threshold (°)
          <input
            type="number"
            min={0}
            max={180}
            value={options.corner_threshold}
            onChange={(event) => onChange({ corner_threshold: Number(event.target.value) })}
          />
        </label>
      </div>
    </details>
  );
}
