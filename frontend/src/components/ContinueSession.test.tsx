// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memorySessions, snapshotOf } from '../lib/session';
import { AUTOSAVE_DELAY_MS, useAutosave } from '../lib/useAutosave';
import { useAppStore } from '../state/store';
import { QUANTIZED, VECTORIZED, sampleDoc } from '../test/fixtures';
import { ContinueSession } from './ContinueSession';

const store = () => useAppStore.getState();
const image = new File(['png'], 'logo.png', { type: 'image/png' });

function kept() {
  useAppStore.setState({
    file: image,
    step: 'result',
    quantized: QUANTIZED,
    vectorized: VECTORIZED,
    editor: sampleDoc(),
  });
  const session = snapshotOf(store(), Date.now() - 5 * 60_000)!;
  store().reset();
  return session;
}

function Autosave({ sessions }: { sessions: ReturnType<typeof memorySessions> }) {
  useAutosave(sessions);
  return null;
}

describe('ContinueSession', () => {
  beforeEach(() => store().reset());
  afterEach(() => vi.useRealTimers());

  it('offers nothing when no design is kept', async () => {
    render(<ContinueSession sessions={memorySessions()} />);
    await act(() => Promise.resolve());
    expect(screen.queryByText('Continue where you left off?')).not.toBeInTheDocument();
  });

  it('continues the kept design', async () => {
    render(<ContinueSession sessions={memorySessions(kept())} />);

    expect(await screen.findByText('Continue where you left off?')).toBeInTheDocument();
    expect(screen.getByText('logo.png · SVG editor · saved 5 minutes ago')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(store().step).toBe('result');
    expect(store().editor).toEqual(sampleDoc());
  });

  it('forgets the kept design on discard', async () => {
    const sessions = memorySessions(kept());
    render(<ContinueSession sessions={sessions} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(screen.queryByText('Continue where you left off?')).not.toBeInTheDocument();
    expect(await sessions.get()).toBeUndefined();
  });
});

describe('useAutosave', () => {
  beforeEach(() => store().reset());
  afterEach(() => vi.useRealTimers());

  it('keeps the design a moment after a change, and forgets it on a new start', async () => {
    vi.useFakeTimers();
    const sessions = memorySessions();
    render(<Autosave sessions={sessions} />);

    act(() => useAppStore.setState({ file: image, step: 'palette', colors: 4 }));
    expect(await sessions.get()).toBeUndefined();
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS));
    expect(await sessions.get()).toMatchObject({ imageName: 'logo.png', colors: 4 });

    act(() => store().reset());
    expect(await sessions.get()).toBeUndefined();
  });

  it('keeps the design right away when the page is hidden', async () => {
    vi.useFakeTimers();
    const sessions = memorySessions();
    render(<Autosave sessions={sessions} />);

    act(() => useAppStore.setState({ file: image, step: 'palette' }));
    window.dispatchEvent(new Event('pagehide'));
    expect(await sessions.get()).toMatchObject({ imageName: 'logo.png' });
  });
});
