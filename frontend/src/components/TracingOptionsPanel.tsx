import { useState } from 'react';
import {
  clampTracingOption,
  isDefaultTracing,
  TRACING_LIMITS,
  type NumericOption,
} from '../lib/tracing';
import type { Stacking, TracingMode, TracingOptions } from '../types/api';

interface TracingOptionsPanelProps {
  options: TracingOptions;
  onChange: (options: Partial<TracingOptions>) => void;
  onReset: () => void;
}

interface NumberOptionProps {
  label: string;
  hint?: string;
  option: NumericOption;
  value: number;
  disabled?: boolean;
  onChange: (options: Partial<TracingOptions>) => void;
}

/**
 * Numeric field that lets the user type freely (e.g. "1" on the way to "10" below the
 * minimum) and only commits values the backend accepts; the rest is clamped on blur.
 */
function NumberOption({ label, hint, option, value, disabled, onChange }: NumberOptionProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const { min, max, step } = TRACING_LIMITS[option];

  const commit = (next: number) => onChange({ [option]: next });

  return (
    <label title={hint}>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={draft ?? value}
        onChange={(event) => {
          setDraft(event.target.value);
          const next = event.target.valueAsNumber;
          if (Number.isFinite(next) && next >= min && next <= max) {
            commit(clampTracingOption(option, next));
          }
        }}
        onBlur={(event) => {
          setDraft(null);
          commit(clampTracingOption(option, event.target.valueAsNumber));
        }}
      />
    </label>
  );
}

export function TracingOptionsPanel({ options, onChange, onReset }: TracingOptionsPanelProps) {
  const polygon = options.mode === 'polygon';

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
        <NumberOption
          label="Remove specks smaller than (px)"
          option="filter_speckle"
          value={options.filter_speckle}
          onChange={onChange}
        />
        <NumberOption
          label="Corner threshold (°)"
          hint="Smaller angles become sharp corners instead of curves."
          option="corner_threshold"
          value={options.corner_threshold}
          onChange={onChange}
        />
        <details className="options__advanced">
          <summary>Advanced</summary>
          <div className="options">
            <NumberOption
              label="Minimum segment length (px)"
              hint="Longer segments give simpler, smoother curves. Smooth curves only."
              option="length_threshold"
              value={options.length_threshold}
              disabled={polygon}
              onChange={onChange}
            />
            <NumberOption
              label="Splice threshold (°)"
              hint="Bends sharper than this start a new curve segment. Smooth curves only."
              option="splice_threshold"
              value={options.splice_threshold}
              disabled={polygon}
              onChange={onChange}
            />
            <NumberOption
              label="Coordinate precision (decimals)"
              hint="Fewer decimals give a smaller SVG with slightly less exact shapes."
              option="path_precision"
              value={options.path_precision}
              onChange={onChange}
            />
          </div>
        </details>
        <button
          type="button"
          className="link options__reset"
          onClick={onReset}
          disabled={isDefaultTracing(options)}
        >
          Restore defaults
        </button>
      </div>
    </details>
  );
}
