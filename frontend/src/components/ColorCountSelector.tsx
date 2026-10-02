interface ColorCountSelectorProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

export function ColorCountSelector({ value, min, max, onChange }: ColorCountSelectorProps) {
  return (
    <label className="color-count">
      <span>Colors: {value}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
