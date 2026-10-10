// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ColorGroup } from '../editor/model';
import type { Filament, MixMatch } from '../lib/mixing';
import { MixTable } from './MixTable';

const filaments: Filament[] = [
  { color: '#ffffff', td: 3 },
  { color: '#ff0000', td: 1.5 },
];
const groups: ColorGroup[] = [
  { paletteIndex: 0, fill: '#ffffff', shapes: [] },
  { paletteIndex: 2, fill: '#ff9999', shapes: [] },
  { paletteIndex: 5, fill: '#00ff00', shapes: [] },
];
const plan = new Map<number, MixMatch>([
  [0, { recipe: { base: 0, top: [] }, predicted: '#ffffff', deltaE: 0 }],
  [
    2,
    { recipe: { base: 0, top: [{ filament: 1, layers: 2 }] }, predicted: '#ff9a9a', deltaE: 1.2 },
  ],
  [5, { recipe: { base: 1, top: [] }, predicted: '#ff0000', deltaE: 86.4 }],
]);

function renderTable(props: Partial<Parameters<typeof MixTable>[0]> = {}) {
  const onTestCard = vi.fn();
  render(
    <MixTable
      groups={groups}
      plan={plan}
      filaments={filaments}
      busy={false}
      onTestCard={onTestCard}
      {...props}
    />,
  );
  return { onTestCard };
}

describe('MixTable', () => {
  it('shows each color with its recipe and color difference', () => {
    renderTable();
    const rows = screen.getAllByRole('listitem');

    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText('2 × 2')).toBeInTheDocument(); // filament 2, 2 layers
    expect(within(rows[1]).getByText('on')).toBeInTheDocument();
    expect(within(rows[1]).getByText('ΔE 1.2')).not.toHaveClass('poor');
    expect(within(rows[0]).queryByText('on')).not.toBeInTheDocument();
  });

  it('flags colors the filaments cannot mix', () => {
    renderTable();

    expect(screen.getByText('ΔE 86.4')).toHaveClass('poor');
    expect(screen.getByText(/1 color cannot be mixed well/)).toBeInTheDocument();
  });

  it('skips colors without a recipe and has no warning when all match', () => {
    renderTable({ plan: new Map([...plan].slice(0, 2)) });

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByText(/cannot be mixed/)).not.toBeInTheDocument();
  });

  it('downloads the test card unless busy', async () => {
    const { onTestCard } = renderTable();

    await userEvent.click(screen.getByRole('button', { name: 'Download test card (3MF)' }));
    expect(onTestCard).toHaveBeenCalledOnce();
  });

  it('disables the test card while busy', () => {
    renderTable({ busy: true });

    expect(screen.getByRole('button', { name: 'Download test card (3MF)' })).toBeDisabled();
  });
});
