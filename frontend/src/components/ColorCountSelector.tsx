interface ColorCountSelectorProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

export function ColorCountSelector({ value, min, max, onChange }: ColorCountSelectorProps) {
  const clamp = (next: number) => Math.min(Math.max(next, min), max);

  return (
    <div className="field">
      <label htmlFor="color-count">Number of colors</label>
      <div className="color-count">
        <input
          id="color-count"
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <input
          type="number"
          aria-label="Number of colors"
          min={min}
          max={max}
          value={value}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(clamp(next));
          }}
        />
      </div>
    </div>
  );
}
