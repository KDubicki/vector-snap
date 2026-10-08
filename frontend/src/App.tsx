import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ImageUpload } from './components/ImageUpload';
import { PaletteStep } from './components/PaletteStep';
import { ResultStep } from './components/ResultStep';
import { STEPS, reachableSteps, useAppStore, type Step } from './state/store';

const STEP_LABELS: Record<Step, string> = { upload: 'Upload', palette: 'Colors', result: 'SVG' };

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
  const { loadLimits, selectFile, goTo } = useAppStore.getState();

  useEffect(() => {
    void loadLimits();
  }, [loadLimits]);

  return (
    <main className="app">
      <header className="app__header">
        <div>
          <h1>VectorSnap</h1>
          <p>Convert JPEG / PNG images to SVG with full control over colors.</p>
        </div>
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
      </header>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {step === 'upload' && (
        <ImageUpload
          maxUploadMb={maxUploadMb}
          onSelect={selectFile}
          onReject={(message) => useAppStore.setState({ error: message })}
        />
      )}
      {step === 'palette' && <PaletteStep />}
      {step === 'result' && <ResultStep />}
    </main>
  );
}
