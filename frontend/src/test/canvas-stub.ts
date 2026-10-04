// jsdom has no 2D canvas. Paper.js probes a context at load time but its geometry,
// hit-testing and SVG import/export never draw, so a no-op context is sufficient.
const noop = () => undefined;

function createContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = {
    canvas,
    globalCompositeOperation: 'source-over',
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    createImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    measureText: () => ({ width: 0 }),
  };
  return new Proxy(state, {
    get: (target, key) => (key in target ? target[key] : noop),
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

if (typeof HTMLCanvasElement !== 'undefined') {
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement) {
    let context = contexts.get(this);
    if (!context) {
      context = createContext(this);
      contexts.set(this, context);
    }
    return context;
  } as unknown as HTMLCanvasElement['getContext'];
}
