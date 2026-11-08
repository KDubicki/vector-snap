/**
 * Opening an SVG file in the editor (docs/07-frontend.md#step-1--upload-): VectorSnap's own
 * downloads open as they are, keeping their color layers and ids; SVGs from other tools
 * go through `POST /svg/import`, which brings them into the contract.
 */

export const SVG_TYPE = 'image/svg+xml';

/** Whether the file is an SVG: by its media type, or its extension when it has none. */
export function isSvgFile(file: File): boolean {
  return file.type ? file.type === SVG_TYPE : file.name.toLowerCase().endsWith('.svg');
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
