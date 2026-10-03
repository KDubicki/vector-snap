import { useEffect } from 'react';
import { ImageUpload } from './components/ImageUpload';
import { PaletteStep } from './components/PaletteStep';
import { ResultStep } from './components/ResultStep';
import { useAppStore, type Step } from './state/store';

const STEPS: { id: Step; label: string }[] = [
  { id: 'upload', label: 'Upload' },
  { id: 'palette', label: 'Colors' },
  { id: 'result', label: 'SVG' },
];

export function App() {
  const step = useAppStore((s) => s.step);
  const error = useAppStore((s) => s.error);
  const { loadLimits, selectFile } = useAppStore.getState();

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
        <ol className="steps">
          {STEPS.map((item, index) => (
            <li key={item.id} aria-current={item.id === step ? 'step' : undefined}>
              <span>{index + 1}</span>
              {item.label}
            </li>
          ))}
        </ol>
      </header>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {step === 'upload' && (
        <ImageUpload
          onSelect={selectFile}
          onReject={(message) => useAppStore.setState({ error: message })}
        />
      )}
      {step === 'palette' && <PaletteStep />}
      {step === 'result' && <ResultStep />}
    </main>
  );
}
