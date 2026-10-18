import { useRef, useState } from 'react';
import { download } from '../lib/download';
import { exportFileName } from '../lib/exportFormats';
import type { PrintSettings } from '../lib/printPlan';
import { presetJson, readPreset } from '../lib/printPreset';

interface PrintSettingsFileProps {
  settings: PrintSettings;
  fileName: string | undefined;
  onLoad: (settings: Partial<PrintSettings>) => void;
}

/** Save the print settings as a file, or load them from one, to reuse them for another design. */
export function PrintSettingsFile({ settings, fileName, onLoad }: PrintSettingsFileProps) {
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const save = () => {
    const blob = new Blob([presetJson(settings)], { type: 'application/json' });
    download(blob, exportFileName(fileName, 'print.json'));
    setMessage(null);
  };

  const load = async (file: File | undefined) => {
    if (!file) return;
    try {
      onLoad(readPreset(await file.text()));
      setMessage({ text: `Loaded the print settings of ${file.name}.`, error: false });
    } catch (caught) {
      setMessage({ text: (caught as Error).message, error: true });
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="print-settings-file">
      <button type="button" className="link" onClick={save}>
        Save print settings
      </button>
      <button type="button" className="link" onClick={() => input.current?.click()}>
        Load print settings…
      </button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Print settings file"
        onChange={(event) => void load(event.target.files?.[0])}
      />
      {message && (
        <p
          className={message.error ? 'field-error' : 'hint'}
          role={message.error ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
