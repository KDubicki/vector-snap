import { describe, expect, it } from 'vitest';
import { apiUrl, curlCommand, shellQuote } from './apiCommand';

describe('API command', () => {
  it('quotes shell words only when needed', () => {
    expect(shellQuote('width_mm=80')).toBe('width_mm=80');
    expect(shellQuote('layer_heights={"0":0.4}')).toBe(`'layer_heights={"0":0.4}'`);
    expect(shellQuote("title=Kid's sign")).toBe(`'title=Kid'\\''s sign'`);
  });

  it('builds a curl command with one form field per line', () => {
    const command = curlCommand(
      'http://localhost:8080/api/v1/export/3mf',
      { width_mm: 80, layered: false, layer_heights: '{"0":0.4}' },
      'logo.svg',
      'logo.3mf',
    );

    expect(command.split(' \\\n')).toEqual([
      'curl --fail',
      '  -F svg=@logo.svg',
      '  -F width_mm=80',
      '  -F layered=false',
      `  -F 'layer_heights={"0":0.4}'`,
      '  http://localhost:8080/api/v1/export/3mf -o logo.3mf',
    ]);
  });

  it('resolves the API base against the page', () => {
    expect(apiUrl('/export/3mf', '/api', 'https://snap.example')).toBe(
      'https://snap.example/api/v1/export/3mf',
    );
    expect(apiUrl('/export/3mf', 'https://api.example/api/', 'https://snap.example')).toBe(
      'https://api.example/api/v1/export/3mf',
    );
  });
});
