/**
 * Opening an SVG file in the editor (docs/07-frontend.md#step-1--upload-): VectorSnap's own
 * downloads open as they are, keeping their color layers and ids; SVGs from other tools
 * go through `POST /svg/import`, which brings them into the contract.
 */

export const SVG_TYPE = 'image/svg+xml';
/** What a file picker offers for SVGs: the media type and both extensions. */
export const SVG_ACCEPT = [SVG_TYPE, '.svg', '.svgz'];

/**
 * Whether the file is an SVG: by its media type, or its extension when it has none. A
 * gzip-compressed one (`.svgz`, as Inkscape saves it) by its extension: systems give it
 * the SVG type, a gzip type or none.
 */
export function isSvgFile(file: File): boolean {
  const name = file.name.toLowerCase();
  if (name.endsWith('.svgz')) return true;
  return file.type ? file.type === SVG_TYPE : name.endsWith('.svg');
}

/**
 * The SVG a file holds: a gzip-compressed one unpacked, as `<name>.svg`, so the editor,
 * *Compare with original* and the saved session get plain SVG; any other file as it is.
 */
export async function unpackSvg(file: File): Promise<File> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return file;
  const packed = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  try {
    const text = await new Response(packed.pipeThrough(new DecompressionStream('gzip'))).text();
    return new File([text], file.name.replace(/\.svgz$/i, '.svg'), { type: SVG_TYPE });
  } catch {
    throw new Error(`${file.name} is compressed (.svgz) but could not be unpacked.`);
  }
}

const SVG_SOURCE = /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg\b/i;

/**
 * SVG code pasted as text — Figma's *Copy as SVG*, an editor's source view — as a file
 * to open; null for any other text.
 */
export function pastedSvg(text: string): File | null {
  const source = text.trim();
  return SVG_SOURCE.test(source) ? new File([source], 'pasted.svg', { type: SVG_TYPE }) : null;
}

const ROOT_TAG = /<svg\b[^>]*>/i;
const OWN_GENERATOR = /\sdata-generator\s*=\s*["']vectorsnap/;
const COLOR_LAYER = /<g\b[^>]*\sdata-palette-index\s*=/;

/**
 * Whether the SVG is a VectorSnap design: made by VectorSnap (`data-generator` on the
 * root) with color layers of the contract. Stickers and stencils carry the mark but not
 * the layers. Read from the text, not with `DOMParser`: parsing another tool's SVG
 * applies its `<style>` and `style` attributes, which the page's CSP reports as
 * violations.
 */
export function isOwnSvg(text: string): boolean {
  const root = ROOT_TAG.exec(text)?.[0] ?? '';
  return OWN_GENERATOR.test(root) && COLOR_LAYER.test(text);
}

const LEFT_OUT: Record<string, [string, string]> = {
  text: ['text', 'texts'],
  images: ['embedded image', 'embedded images'],
  invisible: ['invisible shape', 'invisible shapes'],
  unfilled: ['unfilled shape', 'unfilled shapes'],
  no_area: ['shape without area', 'shapes without area'],
};

function counted(count: number, [one, many]: [string, string]): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** What the import changed, for people; null when it took everything as it was. */
export function importNotice(name: string, ignored: Record<string, number>): string | null {
  const left = Object.entries(LEFT_OUT)
    .filter(([kind]) => (ignored[kind] ?? 0) > 0)
    .map(([kind, names]) => counted(ignored[kind], names));
  const gradients = ignored.gradients ?? 0;
  const parts = [
    ...(left.length ? [`left out ${left.join(', ')}`] : []),
    ...(gradients
      ? [
          `filled ${counted(gradients, ['gradient', 'gradients'])} with ${gradients === 1 ? 'its' : 'their'} average color`,
        ]
      : []),
  ];
  return parts.length ? `${name} was opened as color areas: ${parts.join('; ')}.` : null;
}
