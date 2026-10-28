/** Shapes of the export formats and their options. */

export interface NumberOption {
  type: 'number';
  name: string;
  label: string;
  unit?: string;
  default: number;
  min: number;
  max: number;
  step: number;
  /** Short explanation shown under the field. */
  hint?: string;
  /** Extra rule involving other options: an error message, or `null` when valid. */
  check?: (value: number, values: ExportValues) => string | null;
  section?: string;
}

export interface BooleanOption {
  type: 'boolean';
  name: string;
  label: string;
  default: boolean;
  section?: string;
}

export interface ChoiceOption {
  type: 'choice';
  name: string;
  label: string;
  default: string;
  choices: readonly { value: string; label: string }[];
  /** Short explanation shown under the field. */
  hint?: string;
  section?: string;
}

export type ExportOption = NumberOption | BooleanOption | ChoiceOption;

export type ExportValues = Record<string, number | boolean | string>;

export interface ExportFormat {
  id: string;
  label: string;
  extension: string;
  description: string;
  options: ExportOption[];
  /** Offers per-color heights (sent as `layer_heights`). */
  perColorHeights?: boolean;
  /** Offers the colors to use; the others are sent as `exclude_colors` (lib/usedColors). */
  colorChoice?: boolean;
  /** Rendered in the browser instead of converted by the backend. */
  client?: boolean;
  /** Built by the backend from the original uploaded image instead of the SVG. */
  source?: 'image';
  /** File extension when it depends on the chosen options (the file format), else `extension`. */
  extensionFor?: (values: ExportValues) => string;
}
