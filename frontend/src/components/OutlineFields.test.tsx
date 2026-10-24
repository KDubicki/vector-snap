// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PRINT, type PrintSettings } from '../lib/printPlan';
import { OutlineFields } from './OutlineFields';

const settings = (change: Partial<PrintSettings> = {}): PrintSettings => ({
  ...DEFAULT_PRINT,
  ...change,
});

describe('OutlineFields', () => {
  it('asks for the outline filament only with outlines', () => {
    const onChange = vi.fn();
    render(<OutlineFields settings={settings()} errors={{}} onChange={onChange} />);

    expect(screen.queryByLabelText('Outline filament')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Outline width (mm)'), { target: { value: '0.8' } });
    expect(onChange).toHaveBeenLastCalledWith({ outlineMm: 0.8 });
  });

  it('picks the color and height and shows the filament it takes', () => {
    const onChange = vi.fn();
    render(
      <OutlineFields
        settings={settings({ outlineMm: 0.8, outlineColor: '#000000' })}
        errors={{}}
        grams={new Map([['#000000', 1.34]])}
        slots={new Map([['#000000', 3]])}
        onChange={onChange}
      />,
    );

    expect(screen.getByText('filament 3 · ≈ 1.3 g')).toBeInTheDocument();
    fireEvent.input(screen.getByLabelText('Outline filament'), { target: { value: '#112233' } });
    expect(onChange).toHaveBeenLastCalledWith({ outlineColor: '#112233' });
    fireEvent.click(screen.getByLabelText('One layer above the colors'));
    expect(onChange).toHaveBeenLastCalledWith({ outlineRaised: true });
  });
});
