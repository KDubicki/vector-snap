import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ContinueSession } from './components/ContinueSession';
import { ImageUpload } from './components/ImageUpload';
import { PaletteStep } from './components/PaletteStep';
import { PrintStep } from './components/PrintStep';
import { ResultStep } from './components/ResultStep';
import { ThemeToggle } from './components/ThemeToggle';
import { useConfirm } from './components/useConfirm';
import { useDiscardGuard } from './components/useDiscardGuard';
import { useAutosave } from './lib/useAutosave';
import { hasUnsavedEdits } from './state/editorSlice';
import { STEPS, reachableSteps, useAppStore, type Step } from './state/store';

const STEP_LABELS: Record<Step, string> = {
  upload: 'Upload',
  palette: 'Colors',
  result: 'SVG',
  print: '3D print',
};

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        d="m3.5 8.5 3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function App() {
  const step = useAppStore((s) => s.step);
  const error = useAppStore((s) => s.error);
  const maxUploadMb = useAppStore((s) => s.limits.max_upload_mb);
  const reachable = useAppStore(useShallow(reachableSteps));
  const unsaved = useAppStore(hasUnsavedEdits);
  const { loadLimits, selectFile, goTo } = useAppStore.getState();
  const { confirm, dialog } = useConfirm();
  const guard = useDiscardGuard(confirm);
  useAutosave();

  useEffect(() => {
    void loadLimits();
  }, [loadLimits]);

  // A step starts at its top (the steps, its first options), not where the last one was
  // scrolled to: the 3D print step would open on its downloads.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);

  // Closing or reloading the tab would lose edits that were not downloaded.
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  return (
    <main className="app">
      <header className="app__header">
        <div>
          <h1>VectorSnap</h1>
          <p>Convert JPEG / PNG images to SVG with full control over colors.</p>
        </div>
        <div className="app__header-end">
          <nav aria-label="Steps">
            <ol className="steps">
              {STEPS.map((item, index) => {
                const current = item === step;
                const done = index < STEPS.indexOf(step);
                const content = (
                  <>
                    <span className="steps__marker">{done ? <CheckIcon /> : index + 1}</span>
                    {STEP_LABELS[item]}
                  </>
                );
                return (
                  <li
                    key={item}
                    aria-current={current ? 'step' : undefined}
                    className={done ? 'steps__done' : undefined}
                  >
                    {!current && reachable.includes(item) ? (
                      <button type="button" className="steps__link" onClick={() => goTo(item)}>
                        {content}
                      </button>
                    ) : (
                      content
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
          <ThemeToggle />
        </div>
      </header>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {step === 'upload' && <ContinueSession />}
      {step === 'upload' && (
        <ImageUpload
          maxUploadMb={maxUploadMb}
          onSelect={(file) => void guard(() => selectFile(file), 'A new image replaces the SVG.')}
          onReject={(message) => useAppStore.setState({ error: message })}
        />
      )}
      {step === 'palette' && <PaletteStep />}
      {step === 'result' && <ResultStep />}
      {step === 'print' && <PrintStep />}
      {dialog}
    </main>
  );
}
