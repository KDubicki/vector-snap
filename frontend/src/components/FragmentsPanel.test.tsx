// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { libraryFile, type Fragment } from '../lib/fragments';
import { useAppStore } from '../state/store';
import { sampleDoc } from '../test/fixtures';
import { FragmentsPanel } from './FragmentsPanel';

const store = () => useAppStore.getState();

const star: Fragment = {
  id: 'star',
  name: 'Star',
  width: 10,
  height: 10,
  shapes: [{ d: 'M0,0 H10 V10 Z', fill: '#ffcc00' }],
  createdAt: '2026-10-10T00:00:00.000Z',
};

const jsonFile = (text: string) => new File([text], 'library.json', { type: 'application/json' });

describe('FragmentsPanel', () => {
  beforeEach(() => {
    store().reset();
    localStorage.clear();
    useAppStore.setState({ editor: sampleDoc(), fragments: [], fragmentsStored: true });
  });

  it('saves the selection under a name', async () => {
    const user = userEvent.setup();
    render(<FragmentsPanel />);
    expect(screen.getByText(/Select shapes and save them/)).toBeInTheDocument();

    store().select('p-1-0');
    await screen.findByLabelText('Fragment name');
    await user.type(screen.getByLabelText('Fragment name'), 'Square');
    await user.click(screen.getByRole('button', { name: 'Save selection' }));

    expect(screen.getByRole('status')).toHaveTextContent('Saved “Square”.');
    expect(store().fragments.map((fragment) => fragment.name)).toEqual(['Square']);
    expect(screen.getByLabelText('Fragment name')).toHaveValue('');
  });

  it('renames in place and keeps the old name when emptied', async () => {
    const user = userEvent.setup();
    useAppStore.setState({ fragments: [star] });
    render(<FragmentsPanel />);

    const name = screen.getByLabelText('Name of fragment Star');
    await user.clear(name);
    await user.type(name, 'Big star{Enter}');
    expect(store().fragments[0].name).toBe('Big star');

    const renamed = screen.getByLabelText('Name of fragment Big star');
    await user.clear(renamed);
    await user.tab();
    expect(store().fragments[0].name).toBe('Big star');
    expect(screen.getByLabelText('Name of fragment Big star')).toHaveValue('Big star');
  });

  it('places a fragment with the chosen colors', async () => {
    const user = userEvent.setup();
    useAppStore.setState({ fragments: [star] });
    render(<FragmentsPanel />);

    await user.click(screen.getByLabelText(/nearest colors/));
    await user.click(screen.getByRole('button', { name: 'Place fragment Star on the image' }));

    expect(store().selection).toEqual(['frag-1-0']);
    expect(store().editor!.groups.at(-1)!.fill).toBe('#ffffff'); // nearest image color
  });

  it('deletes a fragment only after confirming', async () => {
    const user = userEvent.setup();
    useAppStore.setState({ fragments: [star] });
    render(<FragmentsPanel />);

    await user.click(screen.getByRole('button', { name: 'Delete fragment Star' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(store().fragments).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Delete fragment Star' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(store().fragments).toHaveLength(0);
  });

  it('exports the library and imports files, reporting what happened', async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toBe('vectorsnap-fragments.json');
    });
    render(<FragmentsPanel />);
    expect(screen.getByRole('button', { name: 'Export library' })).toBeDisabled();

    const input = screen.getByLabelText('Import library…');
    await user.upload(input, jsonFile(libraryFile([star])));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Imported 1 fragment.'),
    );
    await user.upload(input, jsonFile(libraryFile([star])));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Nothing new: 1 fragment already'),
    );
    await user.upload(input, jsonFile('{"oops": 1}'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('not a VectorSnap'));

    await user.click(screen.getByRole('button', { name: 'Export library' }));
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it('warns when the library cannot be stored', () => {
    useAppStore.setState({ fragmentsStored: false });
    render(<FragmentsPanel />);

    expect(screen.getByRole('alert')).toHaveTextContent('does not allow storing');
  });
});
