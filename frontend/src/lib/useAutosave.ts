import { useEffect } from 'react';
import { useAppStore } from '../state/store';
import { indexedDbSessions, sessionChanged, snapshotOf, type SessionStore } from './session';

/** Wait this long after the last change before keeping the design (ms). */
export const AUTOSAVE_DELAY_MS = 1000;

/**
 * Keep the design in `sessions` a moment after every change, and right away when the
 * page is hidden (tab closed, reloaded, switched away). Starting over with a new image
 * forgets it.
 */
export function useAutosave(sessions: SessionStore = indexedDbSessions) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let waiting = false;
    const save = () => {
      clearTimeout(timer);
      waiting = false;
      const session = snapshotOf(useAppStore.getState());
      if (session) void sessions.set(session);
    };
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (previous.file && !state.file) {
        clearTimeout(timer);
        waiting = false;
        void sessions.clear();
      } else if (state.file && sessionChanged(state, previous)) {
        clearTimeout(timer);
        waiting = true;
        timer = setTimeout(save, AUTOSAVE_DELAY_MS);
      }
    });
    const onHide = () => {
      if (waiting) save();
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      clearTimeout(timer);
      unsubscribe();
      window.removeEventListener('pagehide', onHide);
    };
  }, [sessions]);
}
