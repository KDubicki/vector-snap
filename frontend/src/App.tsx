import { useState } from 'react';
import { ColorCountSelector } from './components/ColorCountSelector';
import { ImageUpload } from './components/ImageUpload';

const DEFAULT_COLORS = 8;

export function App() {
  const [file, setFile] = useState<File | null>(null);
  const [colors, setColors] = useState(DEFAULT_COLORS);

  // TODO: wizard steps (upload → palette → editor) and Zustand store (docs/07-frontend.md)
  return (
    <main className="app">
      <header>
        <h1>VectorSnap</h1>
        <p>Convert JPEG / PNG images to SVG with full control over colors.</p>
      </header>

      <ImageUpload onSelect={setFile} />

      {file && (
        <section>
          <p>
            Selected: <strong>{file.name}</strong> ({Math.round(file.size / 1024)} KB)
          </p>
          <ColorCountSelector value={colors} min={2} max={64} onChange={setColors} />
        </section>
      )}
    </main>
  );
}
