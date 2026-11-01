import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { EditorScene, type ViewPoint } from '../editor/scene';
import { BACKDROPS, readBackdrop, saveBackdrop, type Backdrop } from '../lib/backdrop';
import { browserStorage } from '../lib/theme';
import { useAppStore } from '../state/store';
import { TOOLS, WHEEL_ZOOM_STEP, type Tool } from './editorTools';
import { ShortcutsDialog } from './ShortcutsDialog';
import { useEditorKeyboard } from './useEditorKeyboard';

const DRAG_THRESHOLD_PX = 3;
/** Minimum distance between recorded knife points, in view pixels. */
const KNIFE_SAMPLE_PX = 4;

interface Gesture {
  mode: 'pending' | 'pan' | 'knife' | 'lasso' | 'marquee' | 'move' | 'pick';
  /** Shape under the pointer when the gesture started (lasso target without selection). */
  startId: string | null;
  start: ViewPoint;
  last: ViewPoint;
  /** Knife line in document coordinates; for a move, the start and the last position. */
  line: ViewPoint[];
}

/** Gestures the drawing tools start; Select starts a box or a move, Hand pans. */
const TOOL_GESTURES: Partial<Record<Tool, Gesture['mode']>> = {
  knife: 'knife',
  lasso: 'lasso',
  eyedropper: 'pick',
};

function viewPoint(event: { clientX: number; clientY: number }, canvas: HTMLElement): ViewPoint {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

const BACKDROP_LABELS: Record<Backdrop, string> = {
  checker: 'Checkerboard',
  light: 'Light',
  dark: 'Dark',
};

/** Interactive SVG editor canvas (selection, knife, zoom, pan). See docs/08-svg-editor.md. */
export function SvgEditor() {
  const editor = useAppStore((s) => s.editor);
  const vectorized = useAppStore((s) => s.vectorized);
  const selection = useAppStore((s) => s.selection);
  const hoveredGroup = useAppStore((s) => s.hoveredGroup);
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
  const [backdrop, setBackdrop] = useState<Backdrop>(() => readBackdrop(browserStorage()));
  const chooseBackdrop = (value: Backdrop) => {
    setBackdrop(value);
    saveBackdrop(browserStorage(), value);
  };
  const [tool, setTool] = useState<Tool>('select');
  const [showShortcuts, setShowShortcuts] = useState(false);

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

  // A color group pointed at in the groups panel: its shapes are outlined.
  useEffect(() => {
    const group = editor?.groups.find((candidate) => candidate.paletteIndex === hoveredGroup);
    sceneRef.current?.hoverShapes(group ? group.shapes.map((shape) => shape.id) : []);
  }, [hoveredGroup, editor]);

  /** Redraw the document, e.g. after shapes were moved on screen only. */
  const redraw = useCallback(() => {
    const { editor: doc, selection: ids } = useAppStore.getState();
    if (!sceneRef.current || !doc) return;
    sceneRef.current.render(doc);
    sceneRef.current.highlight(ids);
  }, []);

  const cancelGesture = useCallback(() => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    sceneRef.current?.drawGuide(null);
    sceneRef.current?.drawMarquee(null);
    if (gesture?.mode === 'move') redraw();
  }, [redraw]);

  const openShortcuts = useCallback(() => setShowShortcuts(true), []);
  useEditorKeyboard({
    sceneRef,
    canvasRef,
    gestureRef,
    spaceRef,
    cancelGesture,
    setTool,
    setZoom,
    openShortcuts,
  });

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const point = viewPoint(event, event.currentTarget);
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const panning = event.button === 1 || spaceRef.current || tool === 'hand';
    const hit = panning ? null : scene.hitTest(point);
    // Dragging a selected shape moves the selection; anywhere else it draws a box.
    const moving = tool === 'select' && hit !== null && selection.includes(hit) && !event.shiftKey;
    scene.hover(null);
    gestureRef.current = {
      mode: panning ? 'pan' : (TOOL_GESTURES[tool] ?? (moving ? 'move' : 'pending')),
      startId: tool === 'lasso' ? hit : null,
      start: point,
      last: point,
      line: [scene.toDocument(point), scene.toDocument(point)],
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const gesture = gestureRef.current;
    const scene = sceneRef.current;
    if (!scene) return;
    const point = viewPoint(event, event.currentTarget);
    if (!gesture) {
      // Preview what a click would select or pick; selected shapes can be dragged.
      const picks = tool === 'select' || tool === 'eyedropper';
      const hit = picks && !spaceRef.current ? scene.hitTest(point) : null;
      scene.hover(hit);
      event.currentTarget.classList.toggle(
        'editor__canvas--movable',
        tool === 'select' && hit !== null && selection.includes(hit),
      );
      return;
    }

    if (gesture.mode === 'pick') return; // the color is picked where the click ends

    if (gesture.mode === 'move') {
      const position = scene.toDocument(point);
      const previous = gesture.line[1];
      scene.previewMove(selection, position.x - previous.x, position.y - previous.y);
      gesture.line[1] = position;
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
    gestureRef.current = null;
    scene?.drawGuide(null);
    scene?.drawMarquee(null);
    if (!gesture || !scene) return;
    const point = viewPoint(event, event.currentTarget);

    if (gesture.mode === 'move') {
      const end = scene.toDocument(point);
      const [start] = gesture.line;
      if (Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) < DRAG_THRESHOLD_PX) {
        // A click, not a drag: the shapes stay and the clicked one becomes the selection.
        redraw();
        select(scene.hitTest(point), false);
      } else {
        useAppStore.getState().moveSelection(end.x - start.x, end.y - start.y);
      }
    } else if (gesture.mode === 'knife') {
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
    } else if (gesture.mode === 'pick') {
      useAppStore.getState().matchSelectionColor(scene.hitTest(point));
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
        {/* Groups wrap as a whole on narrow screens, never splitting e.g. Undo from Redo. */}
        <div className="editor__group" role="group" aria-label="Tool">
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
        </div>
        <div className="editor__group" role="group" aria-label="Edit">
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
          <button
            type="button"
            onClick={() => useAppStore.getState().mergeSelection()}
            disabled={selection.length < 2}
            title="Merge selected shapes into one (M)"
          >
            Merge
          </button>
        </div>
        <div className="editor__group" role="group" aria-label="Zoom">
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
        </div>
        <div className="editor__group" role="group" aria-label="Background">
          {BACKDROPS.map((value) => (
            <button
              key={value}
              type="button"
              className="editor__backdrop"
              aria-pressed={backdrop === value}
              aria-label={`${BACKDROP_LABELS[value]} background`}
              title={`${BACKDROP_LABELS[value]} background`}
              onClick={() => chooseBackdrop(value)}
            >
              <span className={`editor__swatch editor__swatch--${value}`} aria-hidden="true" />
            </button>
          ))}
        </div>
        <button
          type="button"
          className="editor__help"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
          onClick={() => setShowShortcuts(true)}
        >
          ?
        </button>
        <span className="hint">{TOOLS.find((item) => item.id === tool)?.hint}</span>
      </div>
      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
      {notice && (
        <p className="editor__notice" role="status">
          {notice}
        </p>
      )}
      <div
        ref={viewportRef}
        className={`editor__viewport ${backdrop === 'checker' ? 'checkerboard' : `editor__viewport--${backdrop}`}`}
      >
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
