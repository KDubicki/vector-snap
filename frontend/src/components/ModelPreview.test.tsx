// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { boxStl } from '../test/models';
import ModelPreview, { type PreviewRequest } from './ModelPreview';

const renderer = vi.hoisted(() => ({
  instances: [] as { disposed: boolean; loop: unknown }[],
}));

// jsdom has no WebGL: the renderer only has to be created, sized and disposed.
vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>();
  class WebGLRenderer {
    domElement = document.createElement('canvas');
    disposed = false;
    loop: unknown = null;
    constructor() {
      renderer.instances.push(this);
    }
    setPixelRatio() {}
    setSize() {}
    render() {}
    setAnimationLoop(loop: unknown) {
      this.loop = loop;
    }
    dispose() {
      this.disposed = true;
    }
  }
  return { ...three, WebGLRenderer };
});

const stl = () => new Blob([boxStl([10, 20, 5])]);
const request = (load: PreviewRequest['load']): PreviewRequest => ({ kind: 'stl', load });

describe('ModelPreview', () => {
  beforeEach(() => void (renderer.instances.length = 0));

  it('loads the model and shows its size, volume, weight and parts', async () => {
    render(<ModelPreview request={request(async () => stl())} onCancel={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Building model…');

    expect(await screen.findByText('10.0 × 20.0 × 5.0 mm')).toBeInTheDocument();
    expect(screen.getByText('1.0 cm³')).toBeInTheDocument();
    expect(screen.getByText(/≈ 1 g solid/)).toBeInTheDocument();
    expect(screen.getByText('1 · 12 triangles')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filament'), { target: { value: 'PETG' } });
    expect(screen.getByLabelText('Filament')).toHaveValue('PETG');
  });

  it('reports load errors', async () => {
    render(
      <ModelPreview
        request={request(() => Promise.reject(new Error('Too detailed')))}
        onCancel={vi.fn()}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Too detailed');
  });

  it('cancels a slow model and frees the renderer when closed', async () => {
    const onCancel = vi.fn();
    let signal: AbortSignal | undefined;
    const { unmount } = render(
      <ModelPreview
        request={request((s) => {
          signal = s;
          return new Promise(() => {});
        })}
        onCancel={onCancel}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    unmount();
    expect(signal?.aborted).toBe(true);
    expect(renderer.instances[0]).toMatchObject({ disposed: true, loop: null });
  });

  it('ignores a model that arrives after closing', async () => {
    let finish: (blob: Blob) => void = () => {};
    const { unmount } = render(
      <ModelPreview
        request={request(() => new Promise((resolve) => (finish = resolve)))}
        onCancel={vi.fn()}
      />,
    );
    unmount();

    await act(async () => finish(stl()));
    await waitFor(() => expect(renderer.instances[0].disposed).toBe(true));
  });
});
