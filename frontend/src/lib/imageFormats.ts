/**
 * Image formats the upload takes: the backend's `supported_formats` (`GET /limits`), as
 * media types. Phones and browsers save WebP and AVIF today, so these are offered with
 * JPEG and PNG (docs/07-frontend.md#step-1--upload-).
 */

const KNOWN: Record<string, { name: string; extensions: string[] }> = {
  'image/jpeg': { name: 'JPEG', extensions: ['.jpg', '.jpeg'] },
  'image/png': { name: 'PNG', extensions: ['.png'] },
  'image/webp': { name: 'WebP', extensions: ['.webp'] },
  'image/avif': { name: 'AVIF', extensions: ['.avif'] },
};

/** What this version of the backend reads; used until `/limits` answers. */
export const DEFAULT_FORMATS = Object.keys(KNOWN);

function subtype(type: string): string {
  return type.split('/')[1] ?? type;
}

function formatName(type: string): string {
  return KNOWN[type]?.name ?? subtype(type).toUpperCase();
}

function extensions(type: string): string[] {
  return KNOWN[type]?.extensions ?? [`.${subtype(type)}`];
}

/** The formats for people: "JPEG, PNG, WebP or AVIF". */
export function formatList(types: string[], conjunction: 'or' | 'and' = 'or'): string {
  const names = types.map(formatName);
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} ${conjunction} ${names[names.length - 1]}`;
}

/** The file picker's `accept`: media types and extensions, for systems that know only one. */
export function acceptAttribute(types: string[]): string {
  return [...types, ...types.flatMap(extensions)].join(',');
}

/**
 * Whether the file is one of `types`. Some systems give no media type for newer formats
 * (an AVIF on an older macOS), so a file without one is judged by its extension; the
 * backend checks the content either way.
 */
export function isSupportedImage(file: File, types: string[]): boolean {
  if (file.type) return types.includes(file.type);
  const name = file.name.toLowerCase();
  return types.some((type) => extensions(type).some((extension) => name.endsWith(extension)));
}
