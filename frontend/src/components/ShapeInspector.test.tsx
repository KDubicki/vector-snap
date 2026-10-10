// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { findShape, shapeFill } from '../editor/model';
import { shapesBounds } from '../editor/transform';
import { useAppStore } from '../state/store';
import { sampleDoc } from '../test/fixtures';
import { ShapeInspector } from './ShapeInspector';

const store = () => useAppStore.getState();
const fillOf = (id: string) => {
  const found = findShape(store().editor!, id)!;
  return shapeFill(found.group, found.shape);
};

describe('ShapeInspector', () => {
  beforeEach(() => {
    store().reset();
    useAppStore.setState({ editor: sampleDoc() });
  });

  it('asks to select a shape first', () => {
    render(<ShapeInspector />);

    expect(screen.getByText(/Select a shape on the canvas/)).toBeInTheDocument();
  });

  it('shows the selection, its size and recolors it', () => {
    store().select('p-1-0');
    render(<ShapeInspector />);

    expect(screen.getByText('Selected shape')).toBeInTheDocument();
    expect(screen.getByLabelText('Selection size')).toHaveTextContent('20 × 20 px');
    fireEvent.change(screen.getByLabelText('Selection color'), { target: { value: '#00ff00' } });
    expect(fillOf('p-1-0')).toBe('#00ff00');
  });

  it('reports mixed colors and resets own colors', async () => {
    store().selectMany(['p-1-0', 'p-1-1']);
    render(<ShapeInspector />);

    expect(screen.getByText('2 shapes selected')).toBeInTheDocument();
    expect(screen.getByText('Mixed colors')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use group color' }));
    expect(fillOf('p-1-1')).toBe('#ff0000');
  });

  it('moves the selection to another group', async () => {
    store().select('p-1-0');
    render(<ShapeInspector />);

    await userEvent.click(screen.getByRole('button', { name: 'Move to group 1 (#ffffff)' }));
    expect(findShape(store().editor!, 'p-1-0')!.group.paletteIndex).toBe(0);
  });

  it('scales, flips and rotates the selection', async () => {
    const user = userEvent.setup();
    store().select('p-1-1');
    render(<ShapeInspector />);
    const width = () => shapesBounds(store().editor!, ['p-1-1'])!.width;

    await user.click(screen.getByRole('button', { name: 'Larger' }));
    expect(width()).toBeCloseTo(11, 1);
    await user.click(screen.getByRole('button', { name: 'Smaller' }));
    expect(width()).toBeCloseTo(10, 1);
    for (const name of ['Flip ↔', 'Flip ↕', 'Rotate 90°']) {
      await user.click(screen.getByRole('button', { name }));
    }
    expect(store().history.past).toHaveLength(5);
  });
});
