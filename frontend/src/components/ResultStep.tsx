import { useMemo } from 'react';
import { useObjectUrl } from '../lib/useObjectUrl';
import { useAppStore } from '../state/store';

function svgFileName(file: File | null): string {
  const base = file?.name.replace(/\.[^.]+$/, '') || 'vectorsnap';
  return `${base}.svg`;
}

export function ResultStep() {
  const vectorized = useAppStore((s) => s.vectorized);
  const file = useAppStore((s) => s.file);
  const { goTo, reset } = useAppStore.getState();

  const blob = useMemo(
    () => (vectorized ? new Blob([vectorized.svg], { type: 'image/svg+xml' }) : null),
    [vectorized],
  );
  const url = useObjectUrl(blob);

  if (!vectorized) return null;
  const { stats, palette } = vectorized;

  return (
    <section className="workspace">
      <figure className="preview preview--large">
        <figcaption>SVG result</figcaption>
        {url && <img className="preview__image checkerboard" src={url} alt="Vectorized SVG" />}
      </figure>
      <aside className="panel">
        <dl className="stats">
          <dt>Shapes</dt>
          <dd>{stats.paths}</dd>
          <dt>File size</dt>
          <dd>{(stats.bytes / 1024).toFixed(1)} KB</dd>
          <dt>Processing</dt>
          <dd>{stats.duration_ms} ms</dd>
        </dl>
        <ul className="swatches" aria-label="Colors used">
          {palette.map((color) => (
            <li key={color.index} style={{ background: color.hex }} title={color.hex} />
          ))}
        </ul>
        <div className="actions">
          <button type="button" className="secondary" onClick={() => goTo('palette')}>
            Back to colors
          </button>
          {url && (
            <a className="button primary" href={url} download={svgFileName(file)}>
              Download SVG
            </a>
          )}
        </div>
        <button type="button" className="link" onClick={reset}>
          Start with a new image
        </button>
      </aside>
    </section>
  );
}
