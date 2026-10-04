// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { EditorDoc } from './model';
import { EditorScene } from './scene';

const doc: EditorDoc = {
  width: 100,
  height: 50,
  groups: [
    {
      paletteIndex: 0,
      fill: '#ff0000',
      shapes: [{ id: 'p-0-0', d: 'M0,0 L50,0 L50,50 L0,50 Z' }],
    },
    {
      paletteIndex: 1,
      fill: '#0000ff',
      shapes: [
        // square with a hole
        { id: 'p-1-0', d: 'M50,0 L100,0 L100,50 L50,50 Z M60,10 L60,40 L90,40 L90,10 Z' },
        { id: 'p-1-1', d: 'M65,15 L85,15 L85,35 L65,35 Z', fill: '#00ff00' },
      ],
    },
  ],
};

function scene(): EditorScene {
  const instance = new EditorScene({ width: 200, height: 100 });
  instance.render(doc);
  instance.fit(doc);
  return instance;
}

describe('EditorScene', () => {
  it('fits the document into the viewport', () => {
    const instance = scene();

    // 200x100 viewport, 100x50 document -> zoom 2 * 0.95, centered
    expect(instance.scope.view.zoom).toBeCloseTo(1.9);
    expect(instance.toDocument({ x: 100, y: 50 })).toEqual({ x: 50, y: 25 });
    expect(instance.relativeZoom).toBeCloseTo(1);
  });

  it('hit-tests the topmost shape and respects holes', () => {
    const instance = scene();
    const at = (x: number, y: number) => {
      const zoom = instance.scope.view.zoom;
      return { x: 100 + (x - 50) * zoom, y: 50 + (y - 25) * zoom };
    };

    expect(instance.hitTest(at(25, 25))).toBe('p-0-0');
    expect(instance.hitTest(at(55, 5))).toBe('p-1-0');
    expect(instance.hitTest(at(75, 25))).toBe('p-1-1');
    expect(instance.hitTest(at(62, 25))).toBeNull(); // inside the hole, outside the island
    expect(instance.hitTest({ x: 1, y: 1 })).toBeNull();
  });

  it('renders shape colors with per-shape overrides', () => {
    const instance = scene();
    const fill = (id: string) =>
      instance.scope.project.getItem({ name: id })?.fillColor?.toCSS(true);

    expect(fill('p-0-0')).toBe('#ff0000');
    expect(fill('p-1-1')).toBe('#00ff00');
  });

  it('highlights selected shapes on the overlay', () => {
    const instance = scene();

    instance.highlight(['p-0-0', 'missing']);

    const overlay = instance.scope.project.layers[2];
    expect(overlay.children).toHaveLength(2);
    expect(overlay.children.map((c) => c.fillColor)).toEqual([null, null]);
    expect(overlay.children.map((c) => c.strokeColor?.toCSS(true))).toEqual(['#111111', '#ffffff']);

    instance.highlight([]);
    expect(overlay.children).toHaveLength(0);
  });

  it('outlines the hovered shape and clears it', () => {
    const instance = scene();
    const hoverLayer = instance.scope.project.layers[1];

    instance.hover('p-0-0');
    instance.hover('p-0-0'); // no-op when unchanged
    expect(hoverLayer.children).toHaveLength(1);
    expect(hoverLayer.children[0].strokeColor?.toCSS(true)).toBe('#2f80ff');

    instance.hover('missing');
    expect(hoverLayer.children).toHaveLength(0);

    instance.hover('p-1-0');
    instance.render(doc); // re-render drops a stale hover outline
    expect(hoverLayer.children).toHaveLength(0);
  });

  it('finds shapes fully inside a rectangle and draws the marquee', () => {
    const instance = scene();

    expect(instance.shapesInside({ x: 60, y: 10 }, { x: 90, y: 40 })).toEqual(['p-1-1']);
    expect(instance.shapesInside({ x: 101, y: 51 }, { x: -1, y: -1 }).sort()).toEqual([
      'p-0-0',
      'p-1-0',
      'p-1-1',
    ]);
    expect(instance.shapesInside({ x: 10, y: 10 }, { x: 20, y: 20 })).toEqual([]);

    const guide = instance.scope.project.layers[3];
    instance.drawMarquee({ x: 0, y: 0 }, { x: 10, y: 10 });
    expect(guide.children).toHaveLength(2);
    instance.drawMarquee(null);
    expect(guide.children).toHaveLength(0);
  });

  it('draws and clears the knife guide', () => {
    const instance = scene();
    const guide = instance.scope.project.layers[3];

    instance.drawGuide([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(guide.children).toHaveLength(2);

    instance.drawGuide([{ x: 0, y: 0 }]);
    expect(guide.children).toHaveLength(0);

    instance.drawGuide(null);
    expect(guide.children).toHaveLength(0);
  });

  it('zooms around a point and clamps the zoom range', () => {
    const instance = scene();
    const before = instance.toDocument({ x: 40, y: 20 });

    instance.zoomAt(2, { x: 40, y: 20 });
    const after = instance.toDocument({ x: 40, y: 20 });
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(instance.relativeZoom).toBeCloseTo(2);

    instance.zoomAt(1000, { x: 0, y: 0 });
    expect(instance.relativeZoom).toBeCloseTo(64);
    instance.zoomAt(1e-6, { x: 0, y: 0 });
    expect(instance.relativeZoom).toBeCloseTo(0.1);
  });

  it('pans by view pixels', () => {
    const instance = scene();
    const before = instance.toDocument({ x: 100, y: 50 });

    instance.panBy(19, 0);

    const after = instance.toDocument({ x: 100, y: 50 });
    expect(after.x).toBeCloseTo(before.x - 10);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('resizes, ignores empty documents when fitting and can be destroyed', () => {
    const instance = scene();
    instance.resize(400, 400);
    expect(instance.scope.view.viewSize.width).toBe(400);

    const zoom = instance.scope.view.zoom;
    instance.fit({ width: 0, height: 0, groups: [] });
    expect(instance.scope.view.zoom).toBe(zoom);

    instance.destroy();
    expect(instance.scope.project).toBeNull();
  });
});
