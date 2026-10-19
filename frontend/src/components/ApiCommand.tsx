import { useState } from 'react';
import { API_BASE_URL } from '../api/client';
import { apiUrl, curlCommand } from '../lib/apiCommand';
import { exportFileName } from '../lib/exportFormats';

interface ApiCommandProps {
  options: Record<string, string | number | boolean>;
  fileName: string | undefined;
}

/** The 3MF export of the current settings as a curl command, shown and copyable. */
export function ApiCommand({ options, fileName }: ApiCommandProps) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const svgName = exportFileName(fileName, 'svg');
  const command = curlCommand(
    apiUrl('/export/3mf', API_BASE_URL, window.location.origin),
    options,
    svgName,
    exportFileName(fileName, '3mf'),
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      setCopied(false); // blocked: the command stays selectable above
    }
  };

  return (
    <details className="options__advanced api-command">
      <summary>API command (curl)</summary>
      <p className="hint">
        The same 3MF from a terminal or a script, for the SVG saved as <code>{svgName}</code>{' '}
        (Download SVG in the editor).
      </p>
      <pre className="api-command__code">{command}</pre>
      <button type="button" className="secondary" onClick={() => void copy()}>
        Copy command
      </button>
      {copied !== null && (
        <span className="hint" role="status">
          {copied ? 'Copied.' : 'Copying is blocked here: select the command above.'}
        </span>
      )}
    </details>
  );
}
