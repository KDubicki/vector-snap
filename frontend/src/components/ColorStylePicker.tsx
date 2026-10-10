import type { PrintSettings } from '../lib/printPlan';

type PrintStyle = PrintSettings['style'];

const STYLES: { value: PrintSettings['style']; label: string; hint: string }[] = [
  {
    value: 'flat',
    label: 'Flat (AMS)',
    hint: 'All colors on the same layers with a level top — for AMS / multi-color printers. Raise colors or elements below to make them stand out.',
  },
  {
    value: 'mixed',
    label: 'Mixed',
    hint: 'More colors than filaments: thin translucent layers printed over another filament blend into new colors (like HueForge). Flat top, AMS.',
  },
  {
    value: 'stepped',
    label: 'Stepped',
    hint: 'Each color one step higher — for a single extruder: change filament at each step (see the filament plan).',
  },
];

interface ColorStylePickerProps {
  style: PrintStyle;
  onChoose: (style: PrintStyle) => void;
}

/** Flat (AMS), mixed or stepped colors, with a short explanation of the choice. */
export function ColorStylePicker({ style, onChoose }: ColorStylePickerProps) {
  return (
    <div className="field">
      <span>Colors</span>
      <div className="segmented" role="radiogroup" aria-label="Color style">
        {STYLES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={style === value}
            className={style === value ? 'active' : ''}
            onClick={() => onChoose(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <span className="hint">{STYLES.find(({ value }) => value === style)?.hint}</span>
    </div>
  );
}
