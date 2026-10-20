// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { saveAsMyProject } from '../lib/myProjects';
import { DEFAULT_PRINT } from '../lib/printPlan';
import { MyProjects } from './MyProjects';

const settings = { ...DEFAULT_PRINT, widthMm: 35 };

describe('MyProjects', () => {
  it('saves the current settings under a name', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MyProjects projects={[]} settings={settings} onApply={vi.fn()} onChange={onChange} />);
    expect(screen.queryByRole('list', { name: 'My projects' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save as my project…' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(screen.getByLabelText('Project name'), 'Dog tag{Enter}');

    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ name: 'Dog tag' })]);
    expect(screen.queryByLabelText('Project name')).not.toBeInTheDocument();
  });

  it('applies, replaces and removes saved projects', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onChange = vi.fn();
    const projects = saveAsMyProject([], 'Dog tag', settings);
    render(
      <MyProjects projects={projects} settings={settings} onApply={onApply} onChange={onChange} />,
    );

    await user.click(screen.getByRole('button', { name: 'Dog tag' }));
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ widthMm: 35, project: 'custom' }),
      'Dog tag',
    );

    await user.click(screen.getByRole('button', { name: 'Save as my project…' }));
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'dog tag' } });
    expect(screen.getByRole('button', { name: 'Replace' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: 'Remove Dog tag' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
