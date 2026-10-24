// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultValues, EXPORT_FORMATS } from '../lib/exportFormats';
import { THEME_STORAGE_KEY } from '../lib/theme';
import { useAppStore } from '../state/store';
import { sampleDoc } from '../test/fixtures';
import { ColorHeightsTable } from './ColorHeightsTable';
import { CompareView } from './CompareView';
import { ConfirmDialog } from './ConfirmDialog';
import { EditorPalettePanel } from './EditorPalettePanel';
import { ElementMap } from './ElementMap';
import { FilamentPlanView } from './FilamentPlanView';
import { SmallShapesSelector } from './SmallShapesSelector';
import { ThemeToggle } from './ThemeToggle';

const store = () => useAppStore.getState();

describe('EditorPalettePanel', () => {
  beforeEach(() => {
    store().reset();
    useAppStore.setState({ editor: sampleDoc() });
  });

  it('recolors a group and selects its shapes', async () => {
    render(<EditorPalettePanel />);

    expect(screen.getByText('2 shapes')).toBeInTheDocument();
    fireEvent.input(screen.getByLabelText('Group 2 color: #ff0000'), {
      target: { value: '#00ff00' },
    });
    expect(store().editor!.groups[1].fill).toBe('#00ff00');
    await userEvent.click(screen.getByRole('button', { name: 'Select all shapes of group 2' }));
    expect(store().selection).toEqual(['p-1-0', 'p-1-1']);
  });

  it('renders nothing without a document', () => {
    useAppStore.setState({ editor: null });
    const { container } = render(<EditorPalettePanel />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('SmallShapesSelector', () => {
  beforeEach(() => {
    store().reset();
    useAppStore.setState({ editor: sampleDoc() });
  });

  it('selects shapes below the area', async () => {
    const user = userEvent.setup();
    render(<SmallShapesSelector />);
    const area = screen.getByLabelText('Select shapes smaller than');

    await user.clear(area);
    expect(screen.getByRole('button', { name: 'Select small shapes' })).toBeDisabled();
    await user.type(area, '150');
    await user.click(screen.getByRole('button', { name: 'Select small shapes' }));
    expect(store().selection).toEqual(['p-1-1']); // 10 × 10 px
  });
});

describe('ElementMap', () => {
  it('marks excluded, raised and selected elements and reports clicks', async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ElementMap
        doc={sampleDoc()}
        selected={['p-1-0']}
        raised={{ 'p-1-1': 2 }}
        excluded={[0]}
        fills={new Map([[1, '#123456']])}
        onSelect={onSelect}
      />,
    );
    const path = (id: string) => container.querySelector(`path[d^="${id}"]`)!;

    expect(path('M0,0')).toHaveClass('element-map__shape--excluded');
    expect(path('M10,10')).toHaveClass('element-map__shape--selected');
    expect(path('M50,10')).toHaveClass('element-map__shape--raised');
    expect(path('M50,10')).toHaveAttribute('fill', '#123456');
    expect(within(path('M50,10') as HTMLElement).getByText(/raised 2 layers/)).toBeInTheDocument();

    await userEvent.click(path('M10,10'));
    expect(onSelect).toHaveBeenLastCalledWith('p-1-0', false);
    fireEvent.click(path('M50,10'), { shiftKey: true });
    expect(onSelect).toHaveBeenLastCalledWith('p-1-1', true);
    fireEvent.click(screen.getByRole('img'));
    expect(onSelect).toHaveBeenLastCalledWith(null, false);
  });

  it('draws the outlines over the colors that print, without catching clicks', () => {
    const { container } = render(
      <ElementMap
        doc={sampleDoc()}
        selected={[]}
        raised={{}}
        excluded={[0]}
        outline={{ color: '#111111', width: 1.5 }}
        onSelect={vi.fn()}
      />,
    );

    const outline = container.querySelector('.element-map__outline')!;
    expect(outline).toHaveAttribute('stroke', '#111111');
    expect(outline).toHaveAttribute('stroke-width', '1.5');
    expect(outline).toHaveAttribute('pointer-events', 'none');
    expect(outline.querySelectorAll('path')).toHaveLength(2); // group 0 is left out
  });

  it('draws the printed size beside the design and mirrors only the design', () => {
    const { container } = render(
      <ElementMap
        doc={sampleDoc()}
        selected={[]}
        raised={{}}
        excluded={[]}
        mirror
        size={{ widthMm: 80, heightMm: 40.04 }}
        onSelect={vi.fn()}
      />,
    );

    // 8 % of the longer side is left for the dimension lines.
    expect(screen.getByRole('img')).toHaveAttribute('viewBox', '0 0 108 58');
    expect(container.querySelector('.element-map__dimensions')).toHaveTextContent('80 mm40 mm');
    expect(container.querySelector('.element-map > g')).toHaveAttribute(
      'transform',
      'matrix(-1 0 0 1 100 0)',
    );
  });
});

describe('ConfirmDialog', () => {
  it('confirms, cancels, and treats Escape and the backdrop as cancel', async () => {
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        title="Delete?"
        message="It is gone."
        confirmLabel="Delete"
        onClose={onClose}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete?' });

    expect(dialog).toHaveAccessibleDescription('It is gone.');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onClose).toHaveBeenLastCalledWith(true);
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenLastCalledWith(false);
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe('FilamentPlanView', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists the changes, warns about conflicts and copies the plan', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(
      <FilamentPlanView
        plan={{
          steps: [
            { z_mm: 0, layer: null, color: '#ffffff' },
            { z_mm: 1.6, layer: null, color: '#ff0000' },
          ],
          conflicts: [{ z_mm: 2, colors: ['#00ff00', '#0000ff'] }],
          height_mm: 2,
        }}
      />,
    );

    expect(screen.getByText('#ffffff')).toBeInTheDocument();
    expect(
      screen.getByText(/Set the printer layer height to see layer numbers/),
    ).toBeInTheDocument();
    expect(screen.getByText(/#00ff00, #0000ff all end at 2 mm/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('#ff0000'));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('keeps offering to copy when the clipboard refuses', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    render(<FilamentPlanView plan={{ steps: [], conflicts: [], height_mm: 1 }} />);

    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });
});

describe('ColorHeightsTable', () => {
  it('shows automatic heights and reports explicit ones', () => {
    const onChange = vi.fn();
    const doc = sampleDoc();
    const stl = EXPORT_FORMATS.find((format) => format.id === 'stl')!;
    render(
      <ColorHeightsTable
        groups={doc.groups}
        heights={[
          { paletteIndex: 0, included: false, height: null },
          { paletteIndex: 1, included: true, height: 2 },
        ]}
        values={defaultValues(stl)}
        error="Include at least one color."
        onChange={onChange}
        onReset={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('#ffffff')).toBeDisabled();
    expect(screen.getByLabelText('#ffffff')).toHaveAttribute(
      'placeholder',
      expect.stringMatching(/^auto /),
    );
    expect(screen.getByText('Include at least one color.')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Include #ffffff'));
    expect(onChange).toHaveBeenLastCalledWith(0, { included: true });
    fireEvent.change(screen.getByLabelText('#ff0000'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(1, { height: null });
    fireEvent.change(screen.getByLabelText('#ff0000'), { target: { value: '3.4' } });
    expect(onChange).toHaveBeenLastCalledWith(1, { height: 3.4 });
  });
});

describe('CompareView', () => {
  it('moves the divider with the slider and by dragging', () => {
    const { container } = render(
      <CompareView originalUrl="blob:o" resultUrl="blob:r" width={200} height={100} />,
    );
    const slider = screen.getByRole('slider');
    const original = screen.getByAltText('Original image');
    const stage = container.querySelector('.compare__stage') as HTMLElement;

    expect(original).toHaveStyle({ clipPath: 'inset(0 50% 0 0)' });
    fireEvent.change(slider, { target: { value: '30' } });
    expect(original).toHaveStyle({ clipPath: 'inset(0 70% 0 0)' });
    expect(slider).toHaveAttribute('aria-valuetext', '30% original');

    stage.getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect;
    stage.setPointerCapture = vi.fn();
    stage.hasPointerCapture = () => true;
    fireEvent.pointerDown(stage, { clientX: 150, pointerId: 1 });
    expect(slider).toHaveValue('75');
    fireEvent.pointerMove(stage, { clientX: 20, pointerId: 1 });
    expect(slider).toHaveValue('10');
    stage.hasPointerCapture = () => false;
    fireEvent.pointerMove(stage, { clientX: 100, pointerId: 1 });
    expect(slider).toHaveValue('10');
  });
});

describe('ThemeToggle', () => {
  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('applies and remembers the chosen theme', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(<ThemeToggle />);
    expect(screen.getByRole('radio', { name: 'Dark theme' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await userEvent.click(screen.getByRole('radio', { name: 'Light theme' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    await userEvent.click(screen.getByRole('radio', { name: 'System theme' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });
});
