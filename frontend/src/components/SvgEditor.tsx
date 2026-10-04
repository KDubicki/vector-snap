import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { EditorScene, type ViewPoint } from '../editor/scene';
import { useAppStore } from '../state/store';

const DRAG_THRESHOLD_PX = 3;
const WHEEL_ZOOM_STEP = 1.15;

function viewPoint(event: { clientX: number; clientY: number }, canvas: HTMLElement): ViewPoint {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/** Interactive SVG editor canvas (selection, zoom, pan). See docs/08-svg-editor.md. */
export function SvgEditor() {
  const editor = useAppStore((s) => s.editor);
  const vectorized = useAppStore((s) => s.vectorized);
  const selection = useAppStore((s) => s.selection);
  const select = useAppStore((s) => s.select);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<EditorScene | null>(null);
  const dragRef = useRef<{ start: ViewPoint; last: ViewPoint; panning: boolean } | null>(null);
  const [zoom, setZoom] = useState(1);

  // Create the Paper.js scene once and keep it sized to the canvas element.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = new EditorScene(canvas);
    sceneRef.current = scene;

    const observer = new ResizeObserver(([entry]) => {
      scene.resize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(canvas);

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      scene.zoomAt(
        event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP,
        viewPoint(event, canvas),
      );
      setZoom(scene.relativeZoom);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      canvas.removeEventListener('wheel', onWheel);
      observer.disconnect();
      scene.destroy();
      sceneRef.current = null;
    };
  }, []);

  // Re-render on every document change; fit only when a new result arrives.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !editor) return;
    scene.render(editor);
    scene.highlight(useAppStore.getState().selection);
  }, [editor]);

  useEffect(() => {
    const scene = sceneRef.current;
    const doc = useAppStore.getState().editor;
    if (!scene || !doc) return;
    scene.fit(doc);
    setZoom(scene.relativeZoom);
  }, [vectorized]);

  useEffect(() => {
    sceneRef.current?.highlight(selection);
  }, [selection, editor]);

  // Keyboard shortcuts: Esc clears the selection, 0 fits, +/- zoom.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const scene = sceneRef.current;
      const canvas = canvasRef.current;
      const doc = useAppStore.getState().editor;
      if (!scene || !canvas || !doc || event.target instanceof HTMLInputElement) return;
      const center = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
      if (event.key === 'Escape') select(null);
      else if (event.key === '0') scene.fit(doc);
      else if (event.key === '+' || event.key === '=') scene.zoomAt(WHEEL_ZOOM_STEP, center);
      else if (event.key === '-') scene.zoomAt(1 / WHEEL_ZOOM_STEP, center);
      else return;
      setZoom(scene.relativeZoom);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [select]);

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = viewPoint(event, event.currentTarget);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { start: point, last: point, panning: event.button === 1 };
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const scene = sceneRef.current;
    if (!drag || !scene) return;
    const point = viewPoint(event, event.currentTarget);
    const moved = Math.hypot(point.x - drag.start.x, point.y - drag.start.y);
    if (!drag.panning && moved < DRAG_THRESHOLD_PX) return;
    drag.panning = true;
    scene.panBy(point.x - drag.last.x, point.y - drag.last.y);
    drag.last = point;
  };

  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.panning || !sceneRef.current) return;
    select(sceneRef.current.hitTest(viewPoint(event, event.currentTarget)), event.shiftKey);
  };

  const zoomBy = (factor: number) => {
    const scene = sceneRef.current;
    const canvas = canvasRef.current;
    if (!scene || !canvas) return;
    scene.zoomAt(factor, { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 });
    setZoom(scene.relativeZoom);
  };

  const fit = () => {
    const scene = sceneRef.current;
    if (!scene || !editor) return;
    scene.fit(editor);
    setZoom(scene.relativeZoom);
  };

  return (
    <div className="editor">
      <div className="editor__toolbar" role="toolbar" aria-label="View">
        <button type="button" onClick={() => zoomBy(1 / WHEEL_ZOOM_STEP)} aria-label="Zoom out">
          −
        </button>
        <output aria-label="Zoom level">{Math.round(zoom * 100)}%</output>
        <button type="button" onClick={() => zoomBy(WHEEL_ZOOM_STEP)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={fit}>
          Fit
        </button>
        <span className="hint">
          Click to select · Shift+click to add · drag to pan · scroll to zoom
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="editor__canvas checkerboard"
        aria-label="SVG editor canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (dragRef.current = null)}
      />
    </div>
  );
}
