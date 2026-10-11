// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PRINT, heightPlan, type PrintSettings } from '../lib/printPlan';
import { sampleDoc } from '../test/fixtures';
import { BasePlateFields } from './BasePlateFields';
import { ColorStylePicker } from './ColorStylePicker';
import { LayerFields } from './LayerFields';
import { PrintColorsTable } from './PrintColorsTable';
import { ProjectPicker } from './ProjectPicker';
import { RaisedElementsPanel } from './RaisedElementsPanel';

const settings = (change: Partial<PrintSettings> = {}): PrintSettings => ({
  ...DEFAULT_PRINT,
  ...change,
});

describe('ProjectPicker', () => {
  it('marks the current project and chooses another', async () => {
    const onChoose = vi.fn();
    render(<ProjectPicker project="keychain" onChoose={onChoose} />);

    expect(screen.getByRole('radio', { name: /Keychain/ })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: /Fridge magnet/ }));
    expect(onChoose).toHaveBeenCalledWith('magnet');
  });
});

describe('ColorStylePicker', () => {
  it('explains the chosen style and offers the others', async () => {
    const onChoose = vi.fn();
    render(<ColorStylePicker style="mixed" onChoose={onChoose} />);

    expect(screen.getByText(/More colors than filaments/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Mixed' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: 'Stepped' }));
    expect(onChoose).toHaveBeenCalledWith('stepped');
  });
});

describe('LayerFields', () => {
  it('shows heights in layers and millimetres and reports changes', () => {
    const onChange = vi.fn();
    render(
      <LayerFields
        settings={settings({ layerMm: 0.2, baseLayers: 8, colorLayers: 2 })}
        errors={{ widthMm: 'Must be between 1 and 1000 mm.' }}
        onChange={onChange}
      />,
    );

    expect(screen.getByText('= 1.6 mm')).toBeInTheDocument();
    expect(screen.getByText('= 0.4 mm')).toBeInTheDocument();
    expect(screen.getByText('Must be between 1 and 1000 mm.')).toBeInTheDocument();
    expect(screen.getByLabelText('Width (mm)')).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(screen.getByLabelText('Printer layer height'), { target: { value: '0.12' } });
    expect(onChange).toHaveBeenLastCalledWith({ layerMm: 0.12 });
    fireEvent.change(screen.getByLabelText('Base plate (layers)'), { target: { value: '10' } });
    expect(onChange).toHaveBeenLastCalledWith({ baseLayers: 10 });
    fireEvent.change(screen.getByLabelText('Colors (layers)'), { target: { value: '3' } });
    expect(onChange).toHaveBeenLastCalledWith({ colorLayers: 3 });
    fireEvent.change(screen.getByLabelText('Width (mm)'), { target: { value: '60' } });
    expect(onChange).toHaveBeenLastCalledWith({ widthMm: 60 });
  });

  it('names the color height a step in stepped mode', () => {
    render(
      <LayerFields settings={settings({ style: 'stepped' })} errors={{}} onChange={vi.fn()} />,
    );

    expect(screen.getByLabelText('Step per color (layers)')).toBeInTheDocument();
  });
});

describe('PrintColorsTable', () => {
  const doc = sampleDoc();

  it('lists printed colors with their height and toggles or raises them', async () => {
    const onChange = vi.fn();
    const current = settings({ excluded: [0], colorRaise: { 1: 2 } });
    render(
      <PrintColorsTable
        doc={doc}
        settings={current}
        colors={heightPlan(doc, current).colors}
        error="Include at least one color."
        onChange={onChange}
      />,
    );

    expect(screen.getByText('left out')).toBeInTheDocument();
    expect(screen.getByText('0.8 mm')).toBeInTheDocument(); // (2 + 2) layers of 0.2 mm
    expect(screen.getByLabelText('Extra layers for #ffffff')).toBeDisabled();
    expect(screen.getByText('Include at least one color.')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Print #ffffff'));
    expect(onChange).toHaveBeenLastCalledWith({ excluded: [] });
    await userEvent.click(screen.getByLabelText('Print #ff0000'));
    expect(onChange).toHaveBeenLastCalledWith({ excluded: [0, 1] });
    fireEvent.change(screen.getByLabelText('Extra layers for #ff0000'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ colorRaise: { 1: 0 } });
  });

  it('makes raised colors flat again', async () => {
    const onChange = vi.fn();
    const flat = settings();
    const { rerender } = render(
      <PrintColorsTable
        doc={doc}
        settings={flat}
        colors={heightPlan(doc, flat).colors}
        onChange={onChange}
      />,
    );
    expect(screen.queryByText('Make all colors flat again')).not.toBeInTheDocument();

    const raised = settings({ colorRaise: { 1: 2 } });
    rerender(
      <PrintColorsTable
        doc={doc}
        settings={raised}
        colors={heightPlan(doc, raised).colors}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByText('Make all colors flat again'));
    expect(onChange).toHaveBeenLastCalledWith({ colorRaise: {} });
  });
});

describe('RaisedElementsPanel', () => {
  const doc = sampleDoc();
  const renderPanel = (current: PrintSettings, selected: string[]) => {
    const onChange = vi.fn();
    const onClearSelection = vi.fn();
    render(
      <RaisedElementsPanel
        doc={doc}
        settings={current}
        selected={selected}
        onClearSelection={onClearSelection}
        onChange={onChange}
      />,
    );
    return { onChange, onClearSelection };
  };

  it('explains how to select elements', () => {
    renderPanel(settings(), ['gone']); // ids no longer in the document are ignored

    expect(screen.getByText(/Select elements in the design/)).toBeInTheDocument();
  });

  it('raises and lowers the selection by layers', async () => {
    const { onChange, onClearSelection } = renderPanel(settings({ shapeRaise: { 'p-1-0': 2 } }), [
      'p-1-0',
    ]);

    expect(screen.getByLabelText('Extra layers for the selection')).toHaveTextContent('+2');
    expect(screen.getByText('+2 layers = 0.4 mm above their color')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'One layer higher' }));
    expect(onChange).toHaveBeenLastCalledWith({ shapeRaise: { 'p-1-0': 3 } });
    await userEvent.click(screen.getByRole('button', { name: 'One layer lower' }));
    expect(onChange).toHaveBeenLastCalledWith({ shapeRaise: { 'p-1-0': 1 } });
    await userEvent.click(screen.getByRole('button', { name: 'Lower to their color' }));
    expect(onChange).toHaveBeenLastCalledWith({ shapeRaise: {} });
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(onClearSelection).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Reset all' }));
    expect(onChange).toHaveBeenLastCalledWith({ shapeRaise: {} });
  });

  it('shows different heights in a mixed selection', () => {
    renderPanel(settings({ shapeRaise: { 'p-1-0': 2 } }), ['p-1-0', 'p-1-1']);

    expect(screen.getByText('(different heights)')).toBeInTheDocument();
    expect(screen.getByLabelText('Extra layers for the selection')).toHaveTextContent('–');
    expect(screen.getByText('1 element raised')).toBeInTheDocument();
  });

  it('cannot lower elements below their color', () => {
    renderPanel(settings(), ['p-1-0']);

    expect(screen.getByRole('button', { name: 'One layer lower' })).toBeDisabled();
    expect(screen.getByText('Not raised: at their color’s height.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lower to their color' })).not.toBeInTheDocument();
  });
});

describe('BasePlateFields', () => {
  it('edits the plate and asks for the magnet depth only with a magnet', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <BasePlateFields settings={settings()} errors={{}} onChange={onChange} />,
    );
    expect(screen.queryByLabelText('Magnet pocket depth (mm)')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Shape'), { target: { value: 'circle' } });
    expect(onChange).toHaveBeenLastCalledWith({ baseShape: 'circle' });
    for (const [label, key] of [
      ['Border around the design (mm)', 'marginMm'],
      ['Hanging loop hole (mm)', 'loopHoleMm'],
      ['Magnet pocket diameter (mm)', 'magnetMm'],
      ['Drop details thinner than (mm)', 'nozzleMm'],
    ]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: '3' } });
      expect(onChange).toHaveBeenLastCalledWith({ [key]: 3 });
    }

    rerender(
      <BasePlateFields
        settings={settings({ magnetMm: 10 })}
        errors={{ magnetDepthMm: 'Needs a base of at least 12 layers (2.4 mm).' }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('Magnet pocket depth (mm)'), {
      target: { value: '1.5' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ magnetDepthMm: 1.5 });
    expect(screen.getByText(/Needs a base of at least 12 layers/)).toBeInTheDocument();
  });
});
