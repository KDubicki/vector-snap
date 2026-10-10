import { useMemo, useState } from 'react';
import { serializeSvg } from '../editor/export';
import { shapeCount } from '../editor/model';
import { exportFileName } from '../lib/exportFormats';
import { useObjectUrl } from '../lib/useObjectUrl';
import { useAppStore } from '../state/store';
import { CompareView } from './CompareView';
import { useConfirm } from './useConfirm';
import { useDiscardGuard } from './useDiscardGuard';
import { EditorPalettePanel } from './EditorPalettePanel';
import { ExportPanel } from './ExportPanel';
import { FragmentsPanel } from './FragmentsPanel';
import { ShapeInspector } from './ShapeInspector';
import { SmallShapesSelector } from './SmallShapesSelector';
import { SvgEditor } from './SvgEditor';

export function ResultStep() {
  const vectorized = useAppStore((s) => s.vectorized);
  const editor = useAppStore((s) => s.editor);
  const edited = useAppStore((s) => s.history.past.length > 0);
  const file = useAppStore((s) => s.file);
  const { goTo, reset, markSaved } = useAppStore.getState();
  const { confirm, dialog } = useConfirm();
  const guard = useDiscardGuard(confirm);

  // The download always reflects the edited document (FR-39).
  const svg = useMemo(() => (editor ? serializeSvg(editor) : null), [editor]);
  const blob = useMemo(() => (svg ? new Blob([svg], { type: 'image/svg+xml' }) : null), [svg]);
  const url = useObjectUrl(blob);
  const originalUrl = useObjectUrl(file);
  const [view, setView] = useState<'edit' | 'compare'>('edit');

  if (!vectorized || !editor || !blob) return null;

  return (
    <section className="workspace">
      <div className="result-main">
        <div className="segmented result-view" role="radiogroup" aria-label="View">
          {(['edit', 'compare'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={view === value}
              className={view === value ? 'active' : ''}
              onClick={() => setView(value)}
            >
              {value === 'edit' ? 'Edit' : 'Compare with original'}
            </button>
          ))}
        </div>
        {view === 'compare' && url && originalUrl ? (
          <CompareView
            originalUrl={originalUrl}
            resultUrl={url}
            width={editor.width}
            height={editor.height}
          />
        ) : (
          <SvgEditor />
        )}
      </div>
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
        <SmallShapesSelector />
        <EditorPalettePanel />
        <FragmentsPanel />
        <div className="actions">
          <button type="button" className="secondary" onClick={() => goTo('palette')}>
            Back to colors
          </button>
          {url && (
            <a
              className="button primary"
              href={url}
              download={exportFileName(file?.name, 'svg')}
              onClick={markSaved}
            >
              {edited ? 'Download edited SVG' : 'Download SVG'}
            </a>
          )}
        </div>
        <button type="button" className="secondary print-cta" onClick={() => goTo('print')}>
          <strong>3D print</strong>
          <span>Magnets, keychains, ornaments — heights per color and element</span>
        </button>
        <ExportPanel />
        <button
          type="button"
          className="link"
          onClick={() => void guard(reset, 'Starting with a new image replaces the SVG.')}
        >
          Start with a new image
        </button>
        {dialog}
      </aside>
    </section>
  );
}
