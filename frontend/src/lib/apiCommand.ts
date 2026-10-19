/**
 * The export of the current settings as a shell command (curl), to repeat it from scripts
 * or convert other designs with the same settings. See docs/05-api-specification.md.
 */

/** A word for a POSIX shell: as it is when safe, else in single quotes ('\'' inside). */
export function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * `curl --fail -F svg=@<svgName> -F <option>=<value> … <url> -o <outName>`, one form field
 * per line. `url` is the full endpoint, e.g. https://host/api/v1/export/3mf.
 */
export function curlCommand(
  url: string,
  options: Record<string, string | number | boolean>,
  svgName: string,
  outName: string,
): string {
  const fields = [
    `svg=@${svgName}`,
    ...Object.entries(options).map(([key, value]) => `${key}=${value}`),
  ];
  return [
    'curl --fail',
    ...fields.map((field) => `  -F ${shellQuote(field)}`),
    `  ${shellQuote(url)} -o ${shellQuote(outName)}`,
  ].join(' \\\n');
}

/** The absolute address of an API path, for a base like `/api` or `https://host/api`. */
export function apiUrl(path: string, base: string, origin: string): string {
  return new URL(`${base.replace(/\/$/, '')}/v1${path}`, origin).toString();
}
