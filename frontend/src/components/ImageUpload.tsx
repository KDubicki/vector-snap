import { useEffect, useState, type ChangeEvent, type DragEvent } from 'react';
import { loadSampleImage } from '../lib/sample';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png'];

interface ImageUploadProps {
  maxUploadMb: number;
  onSelect: (file: File) => void;
  onReject: (message: string) => void;
}

function UploadIcon() {
  return (
    <svg className="upload__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 16V4m0 0L7 9m5-5 5 5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ImageUpload({ maxUploadMb, onSelect, onReject }: ImageUploadProps) {
  const [dragging, setDragging] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);

  const accept = (file: File | undefined) => {
    if (!file) return;
    if (ACCEPTED_TYPES.includes(file.type)) onSelect(file);
    else onReject('Only JPEG and PNG images are supported.');
  };

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const item = Array.from(event.clipboardData?.files ?? [])[0];
      if (item) accept(item);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    accept(event.dataTransfer.files[0]);
  };

  const trySample = async () => {
    setLoadingSample(true);
    try {
      onSelect(await loadSampleImage());
    } catch (error) {
      onReject(error instanceof Error ? error.message : 'Could not load the sample image.');
    } finally {
      setLoadingSample(false);
    }
  };

  return (
    <div
      className={`upload${dragging ? ' upload--dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        // Moving over a child element also fires dragleave on the zone.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <UploadIcon />
      <strong>{dragging ? 'Release to upload' : 'Drop a JPEG or PNG here'}</strong>
      <span>or paste an image from the clipboard</span>
      <label className="button primary upload__choose">
        Choose image
        <input
          className="visually-hidden"
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          onChange={(event: ChangeEvent<HTMLInputElement>) => accept(event.target.files?.[0])}
        />
      </label>
      <span className="hint">JPEG or PNG, up to {maxUploadMb} MB</span>
      <button
        type="button"
        className="link"
        disabled={loadingSample}
        onClick={() => void trySample()}
      >
        {loadingSample ? 'Loading sample…' : 'No image at hand? Try a sample'}
      </button>
    </div>
  );
}
