import { useMemo } from 'react';
import { useObjectUrl } from '../lib/useObjectUrl';
import { useAppStore } from '../state/store';
import { EditorPalettePanel } from './EditorPalettePanel';
import { ShapeInspector } from './ShapeInspector';
import { SvgEditor } from './SvgEditor';

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
  const { stats } = vectorized;

  return (
    <section className="workspace">
      <SvgEditor />
      <aside className="panel">
        <dl className="stats">
          <dt>Shapes</dt>
          <dd>{stats.paths}</dd>
          <dt>File size</dt>
          <dd>{(stats.bytes / 1024).toFixed(1)} KB</dd>
          <dt>Processing</dt>
          <dd>{stats.duration_ms} ms</dd>
        </dl>
        <ShapeInspector />
        <EditorPalettePanel />
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
