import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { EditorScene, type ViewPoint } from '../editor/scene';
import { useAppStore } from '../state/store';

const DRAG_THRESHOLD_PX = 3;
const WHEEL_ZOOM_STEP = 1.15;
/** Minimum distance between recorded knife points, in view pixels. */
const KNIFE_SAMPLE_PX = 4;

type Tool = 'select' | 'hand' | 'knife' | 'lasso';

const TOOLS: { id: Tool; label: string; key: string; title: string; hint: string }[] = [
  {
    id: 'select',
    label: 'Select',
    key: 'v',
    title: 'Select (V): click a shape or drag a box around shapes',
    hint: 'Click to select · drag a box to select shapes inside · Shift adds · Space+drag pans',
  },
  {
    id: 'hand',
    label: 'Hand',
    key: 'h',
    title: 'Hand (H): drag to pan',
    hint: 'Drag to pan · scroll to zoom',
  },
  {
    id: 'knife',
    label: 'Knife',
    key: 'k',
    title: 'Knife (K): draw a line across shapes to split them',
    hint: 'Draw across shapes to split them · Shift: straight line · Space+drag pans',
  },
  {
    id: 'lasso',
    label: 'Lasso',
    key: 'l',
    title: 'Lasso (L): draw around part of a shape to cut it out',
    hint: 'Start on a shape (or select shapes first) and draw around the part to cut out',
  },
];

interface Gesture {
  mode: 'pending' | 'pan' | 'knife' | 'lasso' | 'marquee';
  /** Shape under the pointer when the gesture started (lasso target without selection). */
  startId: string | null;
  start: ViewPoint;
  last: ViewPoint;
  /** Knife line in document coordinates. */
  line: ViewPoint[];
}

const NON_TEXT_INPUTS = new Set(['color', 'range', 'checkbox', 'radio', 'button', 'file']);

/** True when keystrokes belong to a text field rather than to the editor shortcuts. */
function isTextField(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  return (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function viewPoint(event: { clientX: number; clientY: number }, canvas: HTMLElement): ViewPoint {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/** Interactive SVG editor canvas (selection, knife, zoom, pan). See docs/08-svg-editor.md. */
export function SvgEditor() {
  const editor = useAppStore((s) => s.editor);
  const vectorized = useAppStore((s) => s.vectorized);
  const selection = useAppStore((s) => s.selection);
  const select = useAppStore((s) => s.select);
  const notice = useAppStore((s) => s.notice);
  const canUndo = useAppStore((s) => s.history.past.length > 0);
  const canRedo = useAppStore((s) => s.history.future.length > 0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<EditorScene | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const spaceRef = useRef(false);
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<Tool>('select');

  // Create the Paper.js scene once and keep it sized to the viewport element.
  // The wrapper is observed, not the canvas: on HiDPI screens Paper.js writes an inline
  // pixel size onto the canvas, and measuring the canvas itself would feed that size back
  // into the observer (a resize loop that shrank the canvas to nothing).
  useEffect(() => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport) return;
    const scene = new EditorScene(canvas);
    sceneRef.current = scene;

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const size = scene.scope.view.viewSize;
      if (
        Math.round(size.width) !== Math.round(width) ||
        Math.round(size.height) !== Math.round(height)
      ) {
        scene.resize(width, height);
      }
    });
    observer.observe(viewport);

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

  const cancelGesture = () => {
    gestureRef.current = null;
    sceneRef.current?.drawGuide(null);
    sceneRef.current?.drawMarquee(null);
  };

  // Keyboard shortcuts: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl+Y redo, Delete removes,
  // V/K tools, Esc cancels/clears, Space pans, 0 fits, +/- zoom.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const scene = sceneRef.current;
      const canvas = canvasRef.current;
      const doc = useAppStore.getState().editor;
      if (!scene || !canvas || !doc || isTextField(event.target)) return;
      const store = useAppStore.getState();
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && (key === 'z' || key === 'y')) {
        event.preventDefault();
        if (key === 'y' || event.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === 'a') {
        event.preventDefault();
        store.selectAll();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const shortcut = TOOLS.find((item) => item.key === key);
      if (shortcut) {
        setTool(shortcut.id);
        return;
      }
      const center = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
      switch (event.key) {
        case ' ':
          spaceRef.current = true;
          event.preventDefault();
          return;
        case 'Delete':
        case 'Backspace':
          event.preventDefault();
          store.deleteSelection();
          return;
        case 'Escape':
          if (gestureRef.current) {
            gestureRef.current = null;
            scene.drawGuide(null);
            scene.drawMarquee(null);
          } else {
            select(null);
          }
          return;
        case '0':
          scene.fit(doc);
          break;
        case '+':
        case '=':
          scene.zoomAt(WHEEL_ZOOM_STEP, center);
          break;
        case '-':
          scene.zoomAt(1 / WHEEL_ZOOM_STEP, center);
          break;
        default:
          return;
      }
      setZoom(scene.relativeZoom);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ') spaceRef.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [select]);

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const point = viewPoint(event, event.currentTarget);
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const panning = event.button === 1 || spaceRef.current || tool === 'hand';
    scene.hover(null);
    gestureRef.current = {
      mode: panning ? 'pan' : tool === 'knife' || tool === 'lasso' ? tool : 'pending',
      startId: tool === 'lasso' ? scene.hitTest(point) : null,
      start: point,
      last: point,
      line: [scene.toDocument(point)],
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const gesture = gestureRef.current;
    const scene = sceneRef.current;
    if (!scene) return;
    const point = viewPoint(event, event.currentTarget);
    if (!gesture) {
      // Preview what a click would select.
      scene.hover(tool === 'select' && !spaceRef.current ? scene.hitTest(point) : null);
      return;
    }

    if (gesture.mode === 'lasso') {
      if (Math.hypot(point.x - gesture.last.x, point.y - gesture.last.y) < KNIFE_SAMPLE_PX) return;
      gesture.line.push(scene.toDocument(point));
      gesture.last = point;
      scene.drawGuide([...gesture.line, gesture.line[0]]);
      return;
    }

    if (gesture.mode === 'knife') {
      if (event.shiftKey) {
        // Straight line from the start point.
        gesture.line = [gesture.line[0], scene.toDocument(point)];
      } else if (
        Math.hypot(point.x - gesture.last.x, point.y - gesture.last.y) >= KNIFE_SAMPLE_PX
      ) {
        gesture.line.push(scene.toDocument(point));
      } else {
        return;
      }
      gesture.last = point;
      scene.drawGuide(gesture.line);
      return;
    }

    const moved = Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y);
    if (gesture.mode === 'pending') {
      if (moved < DRAG_THRESHOLD_PX) return;
      gesture.mode = 'marquee';
    }
    if (gesture.mode === 'marquee') {
      scene.drawMarquee(gesture.line[0], scene.toDocument(point));
      return;
    }
    scene.panBy(point.x - gesture.last.x, point.y - gesture.last.y);
    gesture.last = point;
  };

  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const gesture = gestureRef.current;
    const scene = sceneRef.current;
    cancelGesture();
    if (!gesture || !scene) return;
    const point = viewPoint(event, event.currentTarget);

    if (gesture.mode === 'knife') {
      const end = scene.toDocument(point);
      const line = event.shiftKey ? [gesture.line[0], end] : [...gesture.line, end];
      useAppStore.getState().splitWithLine(line);
    } else if (gesture.mode === 'lasso') {
      useAppStore
        .getState()
        .cutWithLasso([...gesture.line, scene.toDocument(point)], gesture.startId);
    } else if (gesture.mode === 'marquee') {
      const ids = scene.shapesInside(gesture.line[0], scene.toDocument(point));
      useAppStore.getState().selectMany(ids, event.shiftKey);
    } else if (gesture.mode === 'pending') {
      select(scene.hitTest(point), event.shiftKey);
    }
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
      <div className="editor__toolbar" role="toolbar" aria-label="Editor tools">
        {TOOLS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={tool === item.id}
            onClick={() => setTool(item.id)}
            title={item.title}
          >
            {item.label}
          </button>
        ))}
        <span className="editor__separator" />
        <button
          type="button"
          onClick={() => useAppStore.getState().undo()}
          disabled={!canUndo}
          title="Undo (Ctrl/Cmd+Z)"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={() => useAppStore.getState().redo()}
          disabled={!canRedo}
          title="Redo (Ctrl/Cmd+Shift+Z)"
        >
          Redo
        </button>
        <button
          type="button"
          onClick={() => useAppStore.getState().deleteSelection()}
          disabled={selection.length === 0}
          title="Delete selected shapes (Delete)"
        >
          Delete
        </button>
        <span className="editor__separator" />
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
        <span className="hint">{TOOLS.find((item) => item.id === tool)?.hint}</span>
      </div>
      {notice && (
        <p className="editor__notice" role="status">
          {notice}
        </p>
      )}
      <div ref={viewportRef} className="editor__viewport checkerboard">
        <canvas
          ref={canvasRef}
          className={`editor__canvas editor__canvas--${tool}`}
          aria-label="SVG editor canvas"
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={cancelGesture}
          onPointerLeave={() => sceneRef.current?.hover(null)}
        />
      </div>
    </div>
  );
}
