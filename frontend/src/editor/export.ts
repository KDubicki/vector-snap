/**
 * Serialize an editor document to the VectorSnap SVG contract (FR-39), the same structure
 * the backend produces (docs/05-api-specification.md#svg-output-contract), so exported
 * files can be re-opened in the editor and processed by other tools consistently.
 */
import type { EditorDoc } from './model';

export const GENERATOR = 'vectorsnap-editor';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

function escapeAttribute(value: string | number): string {
  return String(value).replace(/[&<>"]/g, (char) => ESCAPES[char]);
}

function attributes(values: Record<string, string | number | undefined>): string {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value as string | number)}"`)
    .join('');
}

export function serializeSvg(doc: EditorDoc): string {
  const groups = doc.groups
    .filter((group) => group.shapes.length > 0)
    .map((group) => {
      const index = group.paletteIndex;
      const paths = group.shapes
        .map(
          (shape) =>
            `<path${attributes({
              id: shape.id,
              'data-palette-index': index,
              d: shape.d,
              fill: shape.fill,
            })}/>`,
        )
        .join('');
      return `<g${attributes({
        id: `color-${index}`,
        'data-palette-index': index,
        fill: group.fill,
      })}>${paths}</g>`;
    })
    .join('');

  return `<svg${attributes({
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: `0 0 ${doc.width} ${doc.height}`,
    width: doc.width,
    height: doc.height,
    'data-generator': GENERATOR,
  })}>${groups}</svg>`;
}
