import { useEffect, useMemo } from 'react';
import { finalPalette } from '../lib/color';
import { filamentName } from '../lib/filamentLibrary';
import { useObjectUrl } from '../lib/useObjectUrl';
import { useAppStore } from '../state/store';
import { ColorCountSelector } from './ColorCountSelector';
import { FilamentLibraryPanel } from './FilamentLibraryPanel';
import { LockedColors } from './LockedColors';
import { PaletteEditor } from './PaletteEditor';
import { QuantizedPreview } from './QuantizedPreview';
import { TracingOptionsPanel } from './TracingOptionsPanel';
import { useConfirm } from './useConfirm';
import { useDiscardGuard } from './useDiscardGuard';

const QUANTIZE_DEBOUNCE_MS = 400;

const METHODS = [
  { value: 'kmeans', label: 'Perceptual (k-means)' },
  { value: 'median_cut', label: 'Fast (median cut)' },
  { value: 'filaments', label: 'My filaments' },
] as const;

const SMOOTH_LEVELS = [
  { value: 0, label: 'Off' },
  { value: 1, label: 'Light' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'Strong' },
];

export function PaletteStep() {
  const file = useAppStore((s) => s.file);
  const colors = useAppStore((s) => s.colors);
  const algorithm = useAppStore((s) => s.algorithm);
  const smooth = useAppStore((s) => s.smooth);
  const upscale = useAppStore((s) => s.upscale);
  const limits = useAppStore((s) => s.limits);
  const quantized = useAppStore((s) => s.quantized);
  const locked = useAppStore((s) => s.locked);
  const suggestedColors = useAppStore((s) => s.suggestedColors);
  const suggesting = useAppStore((s) => s.suggesting);
  const overrides = useAppStore((s) => s.overrides);
  const transparent = useAppStore((s) => s.transparent);
  const tracing = useAppStore((s) => s.tracing);
  const status = useAppStore((s) => s.status);
  const filamentLibrary = useAppStore((s) => s.filamentLibrary);
  const actions = useAppStore.getState();
  const { confirm, dialog } = useConfirm();
  const guard = useDiscardGuard(confirm);

  const sourceUrl = useObjectUrl(file);
  const canLock = locked.length < colors;

  useEffect(() => {
    if (!file) return;
    const timer = setTimeout(() => void useAppStore.getState().runQuantize(), QUANTIZE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [file, colors, algorithm, smooth, upscale, locked, filamentLibrary]);

  const originalPalette = useMemo(() => quantized?.palette.map((c) => c.hex) ?? [], [quantized]);
  const targetPalette = useMemo(
    () =>
      quantized
        ? finalPalette(quantized.palette, overrides).map((hex, index) =>
            transparent.includes(index) ? null : hex,
          )
        : [],
    [quantized, overrides, transparent],
  );

  return (
    <section className="workspace">
      <div className="previews">
        <figure className="preview">
          <figcaption>Original</figcaption>
          {sourceUrl && <img className="preview__image" src={sourceUrl} alt="Original upload" />}
        </figure>
        <figure className="preview">
          <figcaption>
            Reduced to {quantized?.palette.length ?? '…'} colors
            {status === 'quantizing' && <span className="spinner" aria-label="Processing" />}
          </figcaption>
          {quantized ? (
            <QuantizedPreview
              image={quantized.image}
              originalPalette={originalPalette}
              targetPalette={targetPalette}
            />
          ) : (
            <div className="preview__placeholder">Reducing colors…</div>
          )}
        </figure>
      </div>

      <aside className="panel">
        <ColorCountSelector
          value={colors}
          min={Math.max(limits.min_colors, locked.length)}
          max={limits.max_colors}
          onChange={actions.setColors}
          suggested={suggestedColors}
          suggesting={suggesting}
          onSuggest={() => void actions.suggestColors()}
        />
        <div className="field">
          <span>Method</span>
          <div className="segmented" role="radiogroup" aria-label="Quantization method">
            {METHODS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={algorithm === value}
                className={algorithm === value ? 'active' : ''}
                onClick={() => actions.setAlgorithm(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="hint">
            {algorithm === 'filaments'
              ? 'For 3D printing: the palette is chosen from the filaments you have, used exactly — no near-duplicate shades, unneeded filaments are left out.'
              : 'Averages the image into new colors, which may not exist as filament.'}
          </span>
        </div>
        {algorithm === 'filaments' && (
          <FilamentLibraryPanel
            library={filamentLibrary}
            maxColors={colors}
            onChange={actions.setFilamentLibrary}
          />
        )}
        <div className="field">
          <span>Smooth regions</span>
          <div className="segmented" role="radiogroup" aria-label="Smooth regions">
            {SMOOTH_LEVELS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={smooth === value}
                className={smooth === value ? 'active' : ''}
                onClick={() => actions.setSmooth(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="hint">
            Removes specks and evens out jagged edges, so photos and scans become clean shapes for
            3D printing and cutting.
          </span>
        </div>
        <div className="field">
          <div className="checkbox">
            <input
              id="upscale"
              type="checkbox"
              checked={upscale}
              onChange={(event) => actions.setUpscale(event.target.checked)}
            />
            <label htmlFor="upscale">Enlarge small images</label>
          </div>
          <span className="hint">
            Images under 1024 px are scaled up (up to 4×) first, so outlines and 3D model edges come
            out smooth instead of stepped.
          </span>
        </div>
        {quantized && (
          <PaletteEditor
            palette={quantized.palette}
            overrides={overrides}
            locked={locked}
            canLock={canLock}
            onLock={actions.lockColor}
            onUnlock={actions.unlockColor}
            transparent={transparent}
            backgroundIndex={quantized.background_index ?? null}
            onToggleTransparent={actions.toggleTransparent}
            onChange={actions.setOverride}
            onReset={actions.resetOverride}
            onResetAll={actions.resetOverrides}
            colorName={(hex) => filamentName(filamentLibrary, hex)}
          />
        )}
        <LockedColors
          locked={locked}
          canLock={canLock}
          onLock={actions.lockColor}
          onUnlock={actions.unlockColor}
        />
        <TracingOptionsPanel
          options={tracing}
          onChange={actions.setTracing}
          onReset={actions.resetTracing}
        />
        <div className="actions">
          <button
            type="button"
            className="secondary"
            onClick={() => void guard(actions.reset, 'Starting with a new image replaces the SVG.')}
          >
            New image
          </button>
          <button
            type="button"
            className="primary"
            disabled={!quantized || status !== 'idle'}
            onClick={() =>
              void guard(
                () => void actions.runVectorize(),
                'Converting again creates a new SVG from these colors.',
              )
            }
          >
            {status === 'vectorizing' ? 'Converting…' : 'Convert to SVG'}
          </button>
        </div>
        {dialog}
      </aside>
    </section>
  );
}
