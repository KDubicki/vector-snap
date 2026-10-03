import { useEffect, useState, type ChangeEvent, type DragEvent } from 'react';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png'];

interface ImageUploadProps {
  onSelect: (file: File) => void;
  onReject: (message: string) => void;
}

export function ImageUpload({ onSelect, onReject }: ImageUploadProps) {
  const [dragging, setDragging] = useState(false);

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

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    accept(event.dataTransfer.files[0]);
  };

  return (
    <label
      className={`upload${dragging ? ' upload--dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <strong>Drop a JPEG or PNG here</strong>
      <span>or click to choose a file — you can also paste an image</span>
      <input
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        onChange={(event: ChangeEvent<HTMLInputElement>) => accept(event.target.files?.[0])}
      />
    </label>
  );
}
