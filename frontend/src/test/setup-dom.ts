// Component tests (files with `@vitest-environment jsdom`): DOM matchers such as
// toBeInTheDocument / toBeDisabled, and an unmounted tree and empty storage after every
// test (remembered settings would otherwise carry over into the next test).
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  if (typeof window !== 'undefined') window.localStorage.clear();
});

// jsdom has no modal dialogs: opening sets `open`, which makes the dialog accessible.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
}

// jsdom 25 has no Blob.text() / arrayBuffer(), which every supported browser has.
function readBlob<T>(read: (reader: FileReader) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as T);
    reader.onerror = () => reject(reader.error);
    read(reader);
  });
}
if (typeof Blob !== 'undefined' && !Blob.prototype.text) {
  Blob.prototype.text = function text(this: Blob) {
    return readBlob<string>((reader) => reader.readAsText(this));
  };
}
if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return readBlob<ArrayBuffer>((reader) => reader.readAsArrayBuffer(this));
  };
}

// jsdom has no layout, so nothing is ever resized: observers never fire.
const scope = globalThis as unknown as Record<string, unknown>;

// ...nor scrolled: jsdom's scrollTo only reports that it is not implemented.
if (typeof window !== 'undefined') window.scrollTo = () => undefined;

if (typeof window !== 'undefined' && !scope.ResizeObserver) {
  scope.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom has no PointerEvent: without it pointer events lose clientX/Y and pointerId.
if (typeof window !== 'undefined' && !scope.PointerEvent) {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }
  scope.PointerEvent = PointerEventPolyfill;
}

// jsdom has no pointer capture; remember captured pointers per element.
if (typeof Element !== 'undefined' && !Element.prototype.setPointerCapture) {
  const captured = new WeakMap<Element, Set<number>>();
  const pointers = (element: Element) => {
    if (!captured.has(element)) captured.set(element, new Set());
    return captured.get(element)!;
  };
  Element.prototype.setPointerCapture = function setPointerCapture(this: Element, id: number) {
    pointers(this).add(id);
  };
  Element.prototype.releasePointerCapture = function releasePointerCapture(
    this: Element,
    id: number,
  ) {
    pointers(this).delete(id);
  };
  Element.prototype.hasPointerCapture = function hasPointerCapture(this: Element, id: number) {
    return pointers(this).has(id);
  };
}
