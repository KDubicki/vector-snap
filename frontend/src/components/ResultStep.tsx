import { useMemo } from 'react';
import { serializeSvg } from '../editor/export';
import { shapeCount } from '../editor/model';
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
  const editor = useAppStore((s) => s.editor);
  const edited = useAppStore((s) => s.history.past.length > 0);
  const file = useAppStore((s) => s.file);
  const { goTo, reset } = useAppStore.getState();

  // The download always reflects the edited document (FR-39).
  const svg = useMemo(() => (editor ? serializeSvg(editor) : null), [editor]);
  const blob = useMemo(() => (svg ? new Blob([svg], { type: 'image/svg+xml' }) : null), [svg]);
  const url = useObjectUrl(blob);

  if (!vectorized || !editor || !blob) return null;

  return (
    <section className="workspace">
      <SvgEditor />
      <aside className="panel">
        <dl className="stats">
          <dt>Shapes</dt>
          <dd>{shapeCount(editor)}</dd>
          <dt>File size</dt>
          <dd>{(blob.size / 1024).toFixed(1)} KB</dd>
          <dt>Tracing</dt>
          <dd>{vectorized.stats.duration_ms} ms</dd>
        </dl>
        <ShapeInspector />
        <EditorPalettePanel />
        <div className="actions">
          <button type="button" className="secondary" onClick={() => goTo('palette')}>
            Back to colors
          </button>
          {url && (
            <a className="button primary" href={url} download={svgFileName(file)}>
              {edited ? 'Download edited SVG' : 'Download SVG'}
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
