// Mirrors the backend OpenAPI schema (docs/05-api-specification.md).

export type QuantizeAlgorithm = 'kmeans' | 'median_cut' | 'filaments';
export type TracingMode = 'spline' | 'polygon';
export type Stacking = 'stacked' | 'cutout';

export interface PaletteColor {
  index: number;
  hex: string;
  rgb?: [number, number, number];
  coverage?: number;
}

export interface Limits {
  max_upload_mb: number;
  max_image_dimension: number;
  min_colors: number;
  max_colors: number;
  supported_formats: string[];
}

export interface EncodedImage {
  media_type: string;
  encoding: 'base64';
  data: string;
}

export interface QuantizeParams {
  colors: number;
  algorithm?: QuantizeAlgorithm;
  /** Hex colors that must appear exactly in the palette (FR-16). */
  locked_colors?: string[];
  /** Clean up noisy color regions: 0 = off, 1-3 = stronger (majority filter). */
  smooth?: number;
  /** Enlarge images under 1024 px (up to 4x) before quantizing, for smoother outlines. */
  upscale?: boolean;
  /** `filaments` algorithm: the available filament colors to choose the palette from. */
  filaments?: string[];
  /** Merge colors covering less than this share of the image (0.02 = 2%); 0 = off. */
  min_coverage?: number;
  /** Merge colors closer than this CIEDE2000 difference into one; 0 = off. */
  merge_delta_e?: number;
}

/** A color merged into its nearest because it covered too little of the image. */
export interface MergedColor {
  hex: string;
  /** The palette color its pixels now have. */
  into: string;
  /** Its share of the image before merging (0–1). */
  coverage: number;
  /** `similar`: looks like `into` (`merge_delta_e`); `small`: too little of the image. */
  reason: 'similar' | 'small';
  /** CIEDE2000 difference to `into`. */
  delta_e: number;
}

export interface QuantizeResponse {
  width: number;
  height: number;
  palette: PaletteColor[];
  has_transparency: boolean;
  /** Palette index dominating the image border (a likely background), if any. */
  background_index?: number | null;
  /** Colors under `min_coverage` merged into their nearest, smallest first. */
  merged?: MergedColor[];
  image: EncodedImage;
}

export interface ColorSuggestion {
  colors: number;
  target_delta_e: number;
  /** Mean color difference (CIE76 ΔE) per evaluated color count; empty for flat images. */
  errors: { colors: number; mean_delta_e: number }[];
}

export interface TracingOptions {
  mode: TracingMode;
  stacking: Stacking;
  filter_speckle: number;
  corner_threshold: number;
  length_threshold: number;
  splice_threshold: number;
  path_precision: number;
}

export interface VectorizeResponse {
  width: number;
  height: number;
  palette: PaletteColor[];
  stats: { paths: number; bytes: number; duration_ms: number };
  svg: string;
}

/** Filament changes for printing a 3D export on a single-extruder printer. */
export interface FilamentPlan {
  /** The starting filament at z = 0, then one entry per change. */
  steps: { z_mm: number; layer: number | null; color: string }[];
  /** Different colors ending at the same height: they cannot be separated by changes. */
  conflicts: { z_mm: number; colors: string[] }[];
  height_mm: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
  request_id: string | null;
}

/** Bounding box of the 3D model (`POST /export/model-size`). */
export interface ModelSize {
  x_mm: number;
  y_mm: number;
  z_mm: number;
}

/** Shapes narrower than the nozzle where they print (`POST /export/print-check`). */
export interface PrintCheck {
  nozzle_mm: number;
  /** Shapes at least half too thin, most thin area first. */
  shapes: {
    id: string;
    palette_index: number;
    color: string;
    area_mm2: number;
    thin_mm2: number;
    /** Nothing of the shape is wide enough to print. */
    vanishes: boolean;
  }[];
  thin_mm2: number;
}

/** Filament changes of a multi-color printer (`POST /export/color-changes`). */
export interface ColorChanges {
  /** Per distinct color, in 3MF filament order: solid volume and weight (PLA). */
  filaments: { color: string; volume_mm3: number; grams: number }[];
  layers: number;
  changes: number;
  max_colors_per_layer: number;
  change_time_s: number;
  purge_mm3: number;
  purge_g: number;
}
