import { Suspense, lazy, useState } from 'react';
import type { EditorDoc } from '../editor/model';
import type { MixMatch } from '../lib/mixing';
import { designHeightMm, nextSelection, outlined, type PrintSettings } from '../lib/printPlan';
import { ElementMap } from './ElementMap';
import type { PreviewRequest } from './ModelPreview';

// three.js is only downloaded when a 3D preview is opened.
const ModelPreview = lazy(() => import('./ModelPreview'));

export type PrintView = 'design' | 'model';

interface PrintPreviewPaneProps {
  doc: EditorDoc;
  settings: PrintSettings;
  view: PrintView;
  onView: (view: PrintView) => void;
  /** Elements selected on the design, to raise them in the panel. */
  selected: string[];
  onSelect: (ids: string[]) => void;
  /** Mixed colors: the recipe per palette index, whose predicted colors can be shown. */
  mix: Map<number, MixMatch>;
  /** The 3D preview and the settings it was built from (`key`), or null before one. */
  preview: { request: PreviewRequest; key: string } | null;
  /** The current settings, to mark a preview built from other ones as stale. */
  previewKey: string;
  invalid: boolean;
  onShowPreview: () => void;
  onCancelPreview: () => void;
}

/** Left side of the 3D print step: the design to select elements on, or the 3D preview. */
export function PrintPreviewPane({
  doc,
  settings,
  view,
  onView,
  selected,
  onSelect,
  mix,
  preview,
  previewKey,
  invalid,
  onShowPreview,
  onCancelPreview,
}: PrintPreviewPaneProps) {
  const [showPredicted, setShowPredicted] = useState(true);
  const mixed = settings.style === 'mixed';

  return (
    <div className="print-main">
      <div className="segmented result-view" role="radiogroup" aria-label="View">
        {(['design', 'model'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={view === value}
            className={view === value ? 'active' : ''}
            onClick={() => onView(value)}
          >
            {value === 'design' ? 'Design' : '3D preview'}
          </button>
        ))}
      </div>
      {view === 'design' ? (
        <figure className="preview print-design">
          <ElementMap
            doc={doc}
            mirror={settings.mirror}
            size={
              doc.width > 0
                ? {
                    widthMm: settings.widthMm,
                    heightMm: designHeightMm(settings.widthMm, doc.height / doc.width),
                  }
                : undefined
            }
            selected={selected}
            raised={settings.shapeRaise}
            excluded={settings.excluded}
            outline={
              outlined(settings)
                ? {
                    color: settings.outlineColor,
                    width: (settings.outlineMm * doc.width) / settings.widthMm,
                  }
                : undefined
            }
            fills={
              mixed && showPredicted
                ? new Map([...mix].map(([index, match]) => [index, match.predicted]))
                : undefined
            }
            onSelect={(id, additive) => onSelect(nextSelection(selected, id, additive))}
          />
          <figcaption className="hint">
            Click an element to select it, Shift+click to add more — then raise it in the panel.
            Dashed outlines mark raised elements.
            {settings.mirror && ' Shown mirrored, as it will print.'}
            {mixed && (
              <label className="print-predicted">
                <input
                  type="checkbox"
                  checked={showPredicted}
                  onChange={(event) => setShowPredicted(event.target.checked)}
                />
                Show predicted print colors
              </label>
            )}
          </figcaption>
        </figure>
      ) : preview ? (
        <Suspense fallback={<p className="hint">Loading 3D viewer…</p>}>
          {preview.key !== previewKey && (
            <p className="hint print-stale" role="status">
              Settings changed —{' '}
              <button type="button" className="link" disabled={invalid} onClick={onShowPreview}>
                update the preview
              </button>
            </p>
          )}
          <ModelPreview request={preview.request} onCancel={onCancelPreview} />
        </Suspense>
      ) : (
        <div className="preview print-empty">
          <p className="hint">The 3D model appears here.</p>
          <button type="button" className="secondary" disabled={invalid} onClick={onShowPreview}>
            Preview 3D
          </button>
        </div>
      )}
    </div>
  );
}
