import { useEffect, useState } from 'react';
import { ownedColors } from '../lib/filamentLibrary';
import {
  indexedDbSessions,
  restoredState,
  savedAgo,
  type Session,
  type SessionStore,
} from '../lib/session';
import { useAppStore, type Step } from '../state/store';

const STEP_NAMES: Record<Step, string> = {
  upload: 'upload',
  palette: 'colors',
  result: 'SVG editor',
  print: '3D print',
};

/** Offers to continue the design kept in this browser, if there is one. */
export function ContinueSession({ sessions = indexedDbSessions }: { sessions?: SessionStore }) {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let current = true;
    void sessions.get().then((kept) => {
      if (current && kept) setSession(kept);
    });
    return () => {
      current = false;
    };
  }, [sessions]);

  if (!session) return null;
  const step = restoredState(session).step ?? 'palette';

  const resume = () => {
    const state = useAppStore.getState();
    const filaments = ownedColors(state.filamentLibrary).join(',');
    useAppStore.setState(restoredState(session, filaments));
  };
  const discard = () => {
    void sessions.clear();
    setSession(null);
  };

  return (
    <section className="continue" aria-label="Continue where you left off">
      <div>
        <strong>Continue where you left off?</strong>
        <span className="hint">
          {session.imageName} · {STEP_NAMES[step]} · saved {savedAgo(session.savedAt)}
          {!session.saved && session.editor && ' · edits not downloaded yet'}
        </span>
      </div>
      <div className="continue__actions">
        <button type="button" className="link" onClick={discard}>
          Discard
        </button>
        <button type="button" className="primary" onClick={resume}>
          Continue
        </button>
      </div>
    </section>
  );
}
