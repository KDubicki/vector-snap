import { useEffect, useMemo } from 'react';
import { finalPalette } from '../lib/color';
import { useObjectUrl } from '../lib/useObjectUrl';
import { useAppStore } from '../state/store';
import { ColorCountSelector } from './ColorCountSelector';
import { LockedColors } from './LockedColors';
import { PaletteEditor } from './PaletteEditor';
import { QuantizedPreview } from './QuantizedPreview';
import { TracingOptionsPanel } from './TracingOptionsPanel';

const QUANTIZE_DEBOUNCE_MS = 400;

export function PaletteStep() {
  const file = useAppStore((s) => s.file);
  const colors = useAppStore((s) => s.colors);
  const algorithm = useAppStore((s) => s.algorithm);
  const limits = useAppStore((s) => s.limits);
  const quantized = useAppStore((s) => s.quantized);
  const locked = useAppStore((s) => s.locked);
  const overrides = useAppStore((s) => s.overrides);
  const tracing = useAppStore((s) => s.tracing);
  const status = useAppStore((s) => s.status);
  const actions = useAppStore.getState();

  const sourceUrl = useObjectUrl(file);
  const canLock = locked.length < colors;

  useEffect(() => {
    if (!file) return;
    const timer = setTimeout(() => void useAppStore.getState().runQuantize(), QUANTIZE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [file, colors, algorithm, locked]);

  const originalPalette = useMemo(() => quantized?.palette.map((c) => c.hex) ?? [], [quantized]);
  const targetPalette = useMemo(
    () => (quantized ? finalPalette(quantized.palette, overrides) : []),
    [quantized, overrides],
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
        />
        <div className="field">
          <span>Method</span>
          <div className="segmented" role="radiogroup" aria-label="Quantization method">
            {(['kmeans', 'median_cut'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={algorithm === value}
                className={algorithm === value ? 'active' : ''}
                onClick={() => actions.setAlgorithm(value)}
              >
                {value === 'kmeans' ? 'Perceptual (k-means)' : 'Fast (median cut)'}
              </button>
            ))}
          </div>
        </div>
        {quantized && (
          <PaletteEditor
            palette={quantized.palette}
            overrides={overrides}
            locked={locked}
            canLock={canLock}
            onLock={actions.lockColor}
            onUnlock={actions.unlockColor}
            onChange={actions.setOverride}
            onReset={actions.resetOverride}
            onResetAll={actions.resetOverrides}
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
          <button type="button" className="secondary" onClick={actions.reset}>
            New image
          </button>
          <button
            type="button"
            className="primary"
            disabled={!quantized || status !== 'idle'}
            onClick={() => void actions.runVectorize()}
          >
            {status === 'vectorizing' ? 'Converting…' : 'Convert to SVG'}
          </button>
        </div>
      </aside>
    </section>
  );
}
