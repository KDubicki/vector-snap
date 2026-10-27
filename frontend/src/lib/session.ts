/**
 * The last design, kept in this browser so a closed tab or a reload can continue it:
 * the image, the color and tracing choices, the reduced colors, the edited SVG and the
 * print settings. IndexedDB holds it (images are too large for localStorage); where it
 * is unavailable (private windows of some browsers) nothing is kept. Undo history is not
 * kept: a continued design starts with a clean history. See docs/07-frontend.md#autosave.
 */
import { emptyHistory } from '../editor/history';
import type { EditorDoc } from '../editor/model';
import type { AppState, Step } from '../state/store';

export const SESSION_VERSION = 1;

/** The fields of the store a session keeps. */
const KEPT = [
  'step',
  'colors',
  'algorithm',
  'smooth',
  'upscale',
  'minCoverage',
  'mergeDeltaE',
  'locked',
  'overrides',
  'transparent',
  'background',
  'tracing',
  'quantized',
  'vectorized',
  'print',
] as const;

type Kept = Pick<AppState, (typeof KEPT)[number]>;

export interface Session extends Kept {
  version: number;
  savedAt: number;
  image: Blob;
  imageName: string;
  imageType: string;
  editor: EditorDoc | null;
  /** Whether the edited SVG was downloaded since its last change. */
  saved: boolean;
}

/** Where sessions are kept: IndexedDB in the app, memory in tests. */
export interface SessionStore {
  get: () => Promise<Session | undefined>;
  set: (session: Session) => Promise<void>;
  clear: () => Promise<void>;
}

/** The session to keep for this state, or null before an image is chosen. */
export function snapshotOf(state: AppState, now = Date.now()): Session | null {
  if (!state.file) return null;
  const kept = Object.fromEntries(KEPT.map((key) => [key, state[key]])) as Kept;
  return {
    ...kept,
    // A conversion in progress is not kept: continuing goes back to its colors.
    step: state.step === 'result' && !state.editor ? 'palette' : state.step,
    version: SESSION_VERSION,
    savedAt: now,
    image: state.file,
    imageName: state.file.name,
    imageType: state.file.type,
    editor: state.editor,
    saved: state.editor === state.savedDoc || state.history.past.length === 0,
  };
}

/** Whether anything a session keeps changed between two states. */
export function sessionChanged(state: AppState, previous: AppState): boolean {
  return (
    state.file !== previous.file ||
    state.editor !== previous.editor ||
    state.savedDoc !== previous.savedDoc ||
    KEPT.some((key) => state[key] !== previous[key])
  );
}

/**
 * Store fields that continue a session where it was left. `filaments` are the colors the
 * `filaments` algorithm offers now (joined), as `runQuantize` compares them.
 */
export function restoredState(session: Session, filaments = ''): Partial<AppState> {
  const file = new File([session.image], session.imageName, { type: session.imageType });
  const kept = Object.fromEntries(KEPT.map((key) => [key, session[key]])) as Kept;
  const editor = session.vectorized ? session.editor : null;
  return {
    ...kept,
    step: reachable(session.step, Boolean(session.quantized), editor !== null),
    file,
    // The reduced colors belong to this image and these choices: no new quantization.
    quantizedFor: session.quantized
      ? {
          file,
          colors: session.colors,
          algorithm: session.algorithm,
          smooth: session.smooth,
          upscale: session.upscale,
          minCoverage: session.minCoverage,
          mergeDeltaE: session.mergeDeltaE,
          locked: session.locked,
          filaments: session.algorithm === 'filaments' ? filaments : '',
        }
      : null,
    editor,
    selection: [],
    history: emptyHistory,
    savedDoc: session.saved ? editor : null,
    error: null,
    status: 'idle',
  };
}

function reachable(step: Step, quantized: boolean, edited: boolean): Step {
  if ((step === 'result' || step === 'print') && !edited) return 'palette';
  if (step === 'upload' && quantized) return 'palette';
  return step;
}

const DATABASE = 'vectorsnap';
const STORE = 'session';
const KEY = 'last';

function request<T>(open: (store: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode) {
  return new Promise<T>((resolve, reject) => {
    const opening = indexedDB.open(DATABASE, 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore(STORE);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result;
      const transaction = database.transaction(STORE, mode);
      const result = open(transaction.objectStore(STORE));
      transaction.oncomplete = () => {
        database.close();
        resolve(result.result);
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
    };
  });
}

/** Sessions in IndexedDB; every call fails quietly (nothing kept) where it is missing. */
export const indexedDbSessions: SessionStore = {
  get: async () => {
    try {
      const session = await request<Session | undefined>((store) => store.get(KEY), 'readonly');
      return session?.version === SESSION_VERSION ? session : undefined;
    } catch {
      return undefined;
    }
  },
  set: async (session) => {
    try {
      await request((store) => store.put(session, KEY), 'readwrite');
    } catch {
      // Storage full or unavailable: the design just is not kept.
    }
  },
  clear: async () => {
    try {
      await request((store) => store.delete(KEY), 'readwrite');
    } catch {
      // Nothing kept to clear.
    }
  },
};

/** Sessions in memory, for tests. */
export function memorySessions(initial?: Session): SessionStore {
  let kept = initial;
  return {
    get: () => Promise.resolve(kept),
    set: (session) => {
      kept = session;
      return Promise.resolve();
    },
    clear: () => {
      kept = undefined;
      return Promise.resolve();
    },
  };
}

/** "5 minutes ago", "yesterday". */
export function savedAgo(savedAt: number, now = Date.now()): string {
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const minutes = Math.round((savedAt - now) / 60_000);
  if (Math.abs(minutes) < 1) return 'just now';
  if (Math.abs(minutes) < 60) return format.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return format.format(hours, 'hour');
  return format.format(Math.round(hours / 24), 'day');
}
