import type { TracingOptions } from '../types/api';

export const DEFAULT_TRACING: TracingOptions = {
  mode: 'spline',
  stacking: 'cutout',
  filter_speckle: 4,
  corner_threshold: 60,
  length_threshold: 4,
  splice_threshold: 45,
  path_precision: 2,
};

export type NumericOption = {
  [K in keyof TracingOptions]: TracingOptions[K] extends number ? K : never;
}[keyof TracingOptions];

interface OptionRange {
  min: number;
  max: number;
  step: number;
}

/** Accepted ranges of the numeric tracing parameters (mirrors `POST /vectorize`). */
export const TRACING_LIMITS: Record<NumericOption, OptionRange> = {
  filter_speckle: { min: 0, max: 128, step: 1 },
  corner_threshold: { min: 0, max: 180, step: 1 },
  length_threshold: { min: 3.5, max: 10, step: 0.5 },
  splice_threshold: { min: 0, max: 180, step: 1 },
  path_precision: { min: 0, max: 8, step: 1 },
};

/**
 * Bring a value typed into a numeric field into the range the backend accepts, snapped to
 * the field's step. Non-numbers (e.g. a cleared field) fall back to the default.
 */
export function clampTracingOption(option: NumericOption, value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TRACING[option];
  const { min, max, step } = TRACING_LIMITS[option];
  const snapped = Math.round(value / step) * step;
  return Math.min(Math.max(snapped, min), max);
}

export function isDefaultTracing(options: TracingOptions): boolean {
  return (Object.keys(DEFAULT_TRACING) as (keyof TracingOptions)[]).every(
    (key) => options[key] === DEFAULT_TRACING[key],
  );
}
