import type { ChangeEvent } from 'react';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png'];

interface ImageUploadProps {
  onSelect: (file: File) => void;
}

export function ImageUpload({ onSelect }: ImageUploadProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && ACCEPTED_TYPES.includes(file.type)) {
      onSelect(file);
    }
  };

  // TODO: drag & drop, clipboard paste, validation against /limits (docs/07-frontend.md)
  return (
    <label className="upload">
      <span>Choose a JPEG or PNG image</span>
      <input type="file" accept={ACCEPTED_TYPES.join(',')} onChange={handleChange} />
    </label>
  );
}
