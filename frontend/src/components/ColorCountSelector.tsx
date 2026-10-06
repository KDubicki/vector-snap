interface ColorCountSelectorProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** Color count suggested for the current image, once requested. */
  suggested: number | null;
  suggesting: boolean;
  onSuggest: () => void;
}

export function ColorCountSelector({
  value,
  min,
  max,
  onChange,
  suggested,
  suggesting,
  onSuggest,
}: ColorCountSelectorProps) {
  const clamp = (next: number) => Math.min(Math.max(next, min), max);

  return (
    <div className="field">
      <div className="field__header">
        <label htmlFor="color-count">Number of colors</label>
        <button
          type="button"
          className="link"
          onClick={onSuggest}
          disabled={suggesting}
          title="Pick the fewest colors that still look close to the original"
        >
          {suggesting ? 'Suggesting…' : 'Suggest'}
        </button>
      </div>
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
      {suggested !== null && (
        <p className="hint" role="status">
          Suggested for this image: {suggested} colors
          {suggested !== value && (
            <>
              {' '}
              —{' '}
              <button type="button" className="link" onClick={() => onChange(suggested)}>
                use it
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}
