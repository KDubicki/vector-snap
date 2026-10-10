/** Labelled number input with an optional suffix ("= 1.6 mm"), hint and error. */
interface NumberFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** Shown after the input, e.g. "= 1.6 mm". */
  suffix?: string;
  hint?: string;
  error?: string;
}

export function NumberField({
  id,
  label,
  suffix,
  hint,
  error,
  onChange,
  ...input
}: NumberFieldProps) {
  return (
    <div className="option">
      <label htmlFor={id}>{label}</label>
      <div className="print-number">
        <input
          id={id}
          type="number"
          {...input}
          value={Number.isFinite(input.value) ? input.value : ''}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => onChange(event.target.valueAsNumber)}
        />
        {suffix && <span className="hint">{suffix}</span>}
      </div>
      {hint && <span className="hint">{hint}</span>}
      {error && (
        <span id={`${id}-error`} className="field-error">
          {error}
        </span>
      )}
    </div>
  );
}
