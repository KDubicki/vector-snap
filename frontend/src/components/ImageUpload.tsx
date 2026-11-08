import { useEffect, useState, type ChangeEvent, type DragEvent } from 'react';
import { acceptAttribute, formatList, isSupportedImage } from '../lib/imageFormats';
import { isSvgFile, pastedSvg, SVG_ACCEPT, SVG_TYPE } from '../lib/openSvg';
import { loadSampleImage } from '../lib/sample';

interface ImageUploadProps {
  maxUploadMb: number;
  /** Media types the backend reads (`supported_formats` of `/limits`); an SVG file is
   * taken too, and opens in the editor. */
  formats: string[];
  /** A chosen image is being read (or scaled down). */
  busy?: boolean;
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

export function ImageUpload({
  maxUploadMb,
  formats,
  busy = false,
  onSelect,
  onReject,
}: ImageUploadProps) {
  const [dragging, setDragging] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);

  const accept = (file: File | undefined) => {
    if (!file) return;
    if (isSupportedImage(file, formats) || isSvgFile(file)) onSelect(file);
    else onReject(`Only ${formatList(formats, 'and')} images and SVG files are supported.`);
  };

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const data = event.clipboardData;
      const item = Array.from(data?.files ?? [])[0];
      if (item) {
        accept(item);
        return;
      }
      // SVG code, unless it is pasted into a text field.
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable]')) return;
      const svg = pastedSvg(data?.getData(SVG_TYPE) || data?.getData('text/plain') || '');
      if (svg) accept(svg);
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
      aria-busy={busy}
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
      <strong>{dragging ? 'Release to upload' : 'Drop an image here'}</strong>
      <span>or paste an image or SVG code from the clipboard</span>
      <label className="button primary upload__choose">
        Choose image
        <input
          className="visually-hidden"
          type="file"
          accept={[acceptAttribute(formats), ...SVG_ACCEPT].join(',')}
          onChange={(event: ChangeEvent<HTMLInputElement>) => accept(event.target.files?.[0])}
        />
      </label>
      <span className="hint" role="status">
        {busy
          ? 'Reading the image…'
          : `${formatList(formats)}, up to ${maxUploadMb} MB — or an SVG to edit`}
      </span>
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
