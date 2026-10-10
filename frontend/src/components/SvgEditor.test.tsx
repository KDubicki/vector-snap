// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { findShape } from '../editor/model';
import { shapesBounds } from '../editor/transform';
import { useAppStore } from '../state/store';
import { sampleDoc } from '../test/fixtures';
import { SvgEditor } from './SvgEditor';

const store = () => useAppStore.getState();

// jsdom canvases are 300 × 150 px: the 100 × 50 design is fitted at 2.85 px per unit,
// centered on (150, 75).
const SCALE = 2.85;
const at = (x: number, y: number) => ({
  clientX: 150 + (x - 50) * SCALE,
  clientY: 75 + (y - 25) * SCALE,
});

function setup() {
  render(<SvgEditor />);
  const canvas = screen.getByLabelText('SVG editor canvas');
  const press = (x: number, y: number, init: Record<string, unknown> = {}) =>
    fireEvent.pointerDown(canvas, { ...at(x, y), pointerId: 1, button: 0, ...init });
  const move = (x: number, y: number, init: Record<string, unknown> = {}) =>
    fireEvent.pointerMove(canvas, { ...at(x, y), pointerId: 1, ...init });
  const release = (x: number, y: number, init: Record<string, unknown> = {}) =>
    fireEvent.pointerUp(canvas, { ...at(x, y), pointerId: 1, ...init });
  const click = (x: number, y: number, init: Record<string, unknown> = {}) => {
    press(x, y, init);
    release(x, y, init);
  };
  /** Drag through the points, moving in small steps like a real pointer. */
  const drag = (points: [number, number][], init: Record<string, unknown> = {}) => {
    press(...points[0], init);
    for (let i = 1; i < points.length; i += 1) {
      const [[x0, y0], [x1, y1]] = [points[i - 1], points[i]];
      for (let step = 1; step <= 4; step += 1) {
        move(x0 + ((x1 - x0) * step) / 4, y0 + ((y1 - y0) * step) / 4, init);
      }
    }
    release(...points[points.length - 1], init);
  };
  return { canvas, press, move, release, click, drag };
}

const bounds = (id: string) => shapesBounds(store().editor!, [id])!;
const ids = () => store().editor!.groups.flatMap((group) => group.shapes.map((shape) => shape.id));

describe('SvgEditor', () => {
  beforeEach(() => {
    store().reset();
    useAppStore.setState({
      editor: sampleDoc(),
      vectorized: {
        width: 100,
        height: 50,
        palette: [],
        stats: { paths: 3, bytes: 1, duration_ms: 1 },
        svg: '',
      },
    });
  });

  it('selects by clicking, adds with Shift and clears on empty canvas', () => {
    const { click } = setup();

    click(20, 20);
    expect(store().selection).toEqual(['p-1-0']);
    click(55, 15, { shiftKey: true });
    expect(store().selection).toEqual(['p-1-0', 'p-1-1']);
    click(-10, -10);
    expect(store().selection).toEqual([]);
  });

  it('marks selected shapes as movable under the pointer', () => {
    const { canvas, click, move } = setup();
    click(20, 20);

    move(20, 20);
    expect(canvas).toHaveClass('editor__canvas--movable');
    move(80, 40);
    expect(canvas).not.toHaveClass('editor__canvas--movable');
  });

  it('drags the selection to move it, as one undo step', () => {
    const { click, drag } = setup();
    click(20, 20);

    drag([
      [20, 20],
      [30, 25],
    ]);
    expect(bounds('p-1-0').x).toBeCloseTo(20, 0);
    expect(bounds('p-1-0').y).toBeCloseTo(15, 0);
    expect(store().history.past).toHaveLength(1);
  });

  it('selects the clicked shape when a selected shape is pressed without dragging', () => {
    const { click } = setup();
    store().selectMany(['p-1-0', 'p-1-1']);

    click(20, 20);
    expect(store().selection).toEqual(['p-1-0']);
    expect(store().history.past).toHaveLength(0);
  });

  it('selects the shapes inside a dragged box', () => {
    const { drag } = setup();

    drag([
      [45, 5],
      [65, 25],
    ]);
    expect(store().selection).toEqual(['p-1-1']);
  });

  it('splits shapes with the knife and cuts with the lasso', async () => {
    const user = userEvent.setup();
    const { drag } = setup();

    await user.click(screen.getByRole('button', { name: 'Knife' }));
    drag([
      [20, 5],
      [20, 35],
    ]);
    expect(ids()).toContain('p-1-0.a');
    expect(store().selection).toHaveLength(2);

    await user.keyboard('{Escape}l'); // without a selection the lasso cuts the shape it starts on
    expect(screen.getByRole('button', { name: 'Lasso' })).toHaveAttribute('aria-pressed', 'true');
    drag([
      [52, 12],
      [70, 12],
      [70, 18],
      [52, 18],
    ]);
    expect(ids()).toContain('p-1-1.a');
  });

  it('draws straight knife lines with Shift and cancels a line with Escape', async () => {
    const user = userEvent.setup();
    const { press, move, drag } = setup();
    await user.keyboard('k');

    press(55, 5);
    move(55, 30);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(ids()).not.toContain('p-1-1.a');

    drag(
      [
        [55, 5],
        [57, 12],
        [55, 30],
      ],
      { shiftKey: true },
    );
    expect(ids()).toContain('p-1-1.a');
  });

  it('pans with the hand tool without selecting', async () => {
    const user = userEvent.setup();
    const { drag, click } = setup();
    await user.click(screen.getByRole('button', { name: 'Hand' }));

    drag([
      [20, 20],
      [40, 20],
    ]);
    expect(store().selection).toEqual([]);
    await user.keyboard('v');
    click(40, 20); // the design moved right by 20 units
    expect(store().selection).toEqual(['p-1-0']);
  });

  it('runs edit commands from the toolbar', async () => {
    const user = userEvent.setup();
    setup();
    const button = (name: string) => screen.getByRole('button', { name });
    expect(button('Delete')).toBeDisabled();
    expect(button('Undo')).toBeDisabled();

    store().selectMany(['p-1-0', 'p-1-1']);
    await user.click(await screen.findByRole('button', { name: 'Merge' }));
    expect(ids()).toEqual(['p-0-0', 'p-1-0']);
    await user.click(button('Delete'));
    expect(ids()).toEqual(['p-0-0']);
    await user.click(button('Undo'));
    await user.click(button('Undo'));
    expect(ids()).toHaveLength(3);
    await user.click(button('Redo'));
    expect(ids()).toHaveLength(2);
  });

  it('handles keyboard shortcuts, but not while typing', async () => {
    const user = userEvent.setup();
    render(
      <>
        <input aria-label="Name" />
        <SvgEditor />
      </>,
    );

    await user.keyboard('{Control>}a{/Control}');
    expect(store().selection).toHaveLength(3);
    await user.keyboard('{Escape}');
    expect(store().selection).toEqual([]);

    store().select('p-1-1');
    await user.keyboard('{ArrowRight}{Shift>}{ArrowDown}{/Shift}');
    expect(bounds('p-1-1')).toMatchObject({ x: 51, y: 20 });
    store().selectMany(['p-1-0', 'p-1-1']);
    await user.keyboard('m');
    expect(ids()).toHaveLength(2);
    await user.keyboard('{Delete}');
    expect(ids()).toEqual(['p-0-0']);
    await user.keyboard('{Control>}z{/Control}');
    expect(ids()).toHaveLength(2);
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(ids()).toEqual(['p-0-0']);
    await user.keyboard('{Control>}y{/Control}');
    expect(ids()).toEqual(['p-0-0']);

    await user.click(screen.getByLabelText('Name'));
    await user.keyboard('k');
    expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true');
    expect(findShape(store().editor!, 'p-0-0')).not.toBeNull();
  });

  it('zooms with buttons, keys and the wheel, and fits again', async () => {
    const user = userEvent.setup();
    const { canvas } = setup();
    const zoom = () => screen.getByLabelText('Zoom level').textContent;

    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(zoom()).toBe('115%');
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(zoom()).toBe('100%');
    await user.keyboard('+');
    await user.keyboard('=');
    expect(zoom()).toBe('132%');
    await user.keyboard('-');
    expect(zoom()).toBe('115%');
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 150, clientY: 75 });
    expect(zoom()).toBe('132%');
    fireEvent.wheel(canvas, { deltaY: 100, clientX: 150, clientY: 75 });
    await user.keyboard('0');
    expect(zoom()).toBe('100%');
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Fit' }));
    expect(zoom()).toBe('100%');
  });

  it('shows notices for edits that did nothing', async () => {
    const user = userEvent.setup();
    const { drag } = setup();
    await user.keyboard('k');

    drag([
      [20, 15],
      [20, 25],
    ]); // starts and ends inside the shape
    expect(screen.getByText(/Draw a line that fully crosses a shape/)).toBeInTheDocument();
  });
});
