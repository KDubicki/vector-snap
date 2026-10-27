// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../state/store';
import { QUANTIZED, VECTORIZED, sampleDoc } from '../test/fixtures';
import {
  memorySessions,
  restoredState,
  savedAgo,
  sessionChanged,
  snapshotOf,
  type Session,
} from './session';

const store = () => useAppStore.getState();
const image = new File(['png'], 'logo.png', { type: 'image/png' });

function editing() {
  const editor = sampleDoc();
  useAppStore.setState({
    file: image,
    step: 'result',
    colors: 5,
    overrides: { 1: '#00ff00' },
    transparent: [2],
    quantized: QUANTIZED,
    vectorized: VECTORIZED,
    editor,
    savedDoc: null,
    history: { past: [editor], future: [], last: null },
  });
}

describe('session', () => {
  beforeEach(() => store().reset());

  it('keeps nothing before an image is chosen', () => {
    expect(snapshotOf(store())).toBeNull();
  });

  it('keeps the image, the choices, the colors, the SVG and the print settings', () => {
    editing();
    const session = snapshotOf(store(), 1000)!;

    expect(session).toMatchObject({
      version: 1,
      savedAt: 1000,
      step: 'result',
      imageName: 'logo.png',
      imageType: 'image/png',
      colors: 5,
      overrides: { 1: '#00ff00' },
      transparent: [2],
      quantized: QUANTIZED,
      vectorized: VECTORIZED,
      editor: store().editor,
      print: store().print,
      saved: false,
    });
    expect(session.image).toBe(image);
  });

  it('continues where it was left, with a clean history and no new quantization', async () => {
    editing();
    const session = snapshotOf(store())!;
    store().reset();

    useAppStore.setState(restoredState(session));

    const state = store();
    expect(state.step).toBe('result');
    expect(state.file?.name).toBe('logo.png');
    expect(await state.file?.text()).toBe('png');
    expect(state.editor).toEqual(sampleDoc());
    expect(state.history.past).toEqual([]);
    expect(state.savedDoc).toBeNull(); // edits not downloaded yet
    expect(state.quantizedFor).toMatchObject({ file: state.file, colors: 5 });
    expect(state.quantizedFor?.locked).toBe(state.locked);
  });

  it('goes back to the colors when the SVG was not kept', () => {
    editing();
    const session: Session = { ...snapshotOf(store())!, vectorized: null, step: 'print' };

    expect(restoredState(session)).toMatchObject({ step: 'palette', editor: null });
  });

  it('notices only changes it keeps', () => {
    editing();
    const before = store();
    useAppStore.setState({ status: 'quantizing', notice: 'Merged.' });
    expect(sessionChanged(store(), before)).toBe(false);
    useAppStore.setState({ colors: 6 });
    expect(sessionChanged(store(), before)).toBe(true);
  });

  it('says how long ago it was saved', () => {
    const now = 10 * 86_400_000;
    expect(savedAgo(now - 10_000, now)).toBe('just now');
    expect(savedAgo(now - 5 * 60_000, now)).toBe('5 minutes ago');
    expect(savedAgo(now - 3 * 3_600_000, now)).toBe('3 hours ago');
    expect(savedAgo(now - 86_400_000, now)).toBe('yesterday');
  });

  it('keeps sessions in memory for tests', async () => {
    editing();
    const sessions = memorySessions();
    await sessions.set(snapshotOf(store())!);
    expect((await sessions.get())?.imageName).toBe('logo.png');
    await sessions.clear();
    expect(await sessions.get()).toBeUndefined();
  });
});
