// Mirrors the backend OpenAPI schema (docs/05-api-specification.md).

export type QuantizeAlgorithm = 'kmeans' | 'median_cut';
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
}

export interface QuantizeResponse {
  width: number;
  height: number;
  palette: PaletteColor[];
  has_transparency: boolean;
  image: EncodedImage;
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

export interface ApiErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
  request_id: string | null;
}
