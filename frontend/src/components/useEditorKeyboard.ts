import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { serializeSvg } from '../editor/export';
import type { EditorScene } from '../editor/scene';
import { download } from '../lib/download';
import { exportFileName } from '../lib/exportFormats';
import { useAppStore } from '../state/store';
import { TOOLS, WHEEL_ZOOM_STEP, type Tool } from './editorTools';

const NUDGE: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};
/** Shift+arrow moves this many document pixels at once. */
const NUDGE_SHIFT = 10;

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

interface EditorKeyboard {
  sceneRef: RefObject<EditorScene | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** A gesture in progress (knife line, lasso, move…), which `Esc` cancels. */
  gestureRef: RefObject<unknown>;
  /** Whether Space is held: the drawing tools pan while it is. */
  spaceRef: RefObject<boolean>;
  cancelGesture: () => void;
  setTool: (tool: Tool) => void;
  setZoom: Dispatch<SetStateAction<number>>;
  openShortcuts: () => void;
}

/**
 * Keyboard shortcuts of the SVG editor: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl+Y redo,
 * Ctrl/Cmd+A select all, Ctrl/Cmd+D duplicate, Ctrl/Cmd+S download, Delete removes, M merges, V/H/K/L/I tools,
 * Shift+I inverts the selection, arrows nudge, Esc cancels/clears, Space pans, 0 fits,
 * +/- zoom, ? lists them (keep src/editor/shortcuts.ts in step). Keys typed into text
 * fields are left alone.
 */
export function useEditorKeyboard({
  sceneRef,
  canvasRef,
  gestureRef,
  spaceRef,
  cancelGesture,
  setTool,
  setZoom,
  openShortcuts,
}: EditorKeyboard): void {
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
      if ((event.metaKey || event.ctrlKey) && key === 'd') {
        event.preventDefault(); // not the browser's bookmark
        store.duplicateSelection();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === 's') {
        event.preventDefault(); // not the browser's "save page"
        download(
          new Blob([serializeSvg(doc)], { type: 'image/svg+xml' }),
          exportFileName(store.file?.name, 'svg'),
        );
        store.markSaved();
        return;
      }
      if (event.key === '?') {
        openShortcuts();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.shiftKey && key === 'i') {
        // Not Ctrl+Shift+I: browsers keep that for their developer tools.
        store.invertSelection();
        return;
      }
      const shortcut = TOOLS.find((item) => item.key === key);
      if (shortcut) {
        setTool(shortcut.id);
        return;
      }
      const nudge = NUDGE[event.key];
      if (nudge && store.selection.length) {
        event.preventDefault();
        const step = event.shiftKey ? NUDGE_SHIFT : 1;
        store.moveSelection(nudge[0] * step, nudge[1] * step);
        return;
      }
      const center = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
      switch (event.key) {
        case ' ':
          spaceRef.current = true;
          event.preventDefault();
          return;
        case 'm':
        case 'M':
          store.mergeSelection();
          return;
        case 'Delete':
        case 'Backspace':
          event.preventDefault();
          store.deleteSelection();
          return;
        case 'Escape':
          if (gestureRef.current) {
            cancelGesture();
          } else {
            store.select(null);
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
  }, [sceneRef, canvasRef, gestureRef, spaceRef, cancelGesture, setTool, setZoom, openShortcuts]);
}
