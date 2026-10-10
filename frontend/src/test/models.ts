import { strToU8, zipSync } from 'three/addons/libs/fflate.module.js';

type Vec = [number, number, number];

// In jsdom, TextEncoder returns arrays of another realm, which fflate takes for folders.
const bytes = (text: string) => new Uint8Array(strToU8(text));

/** The 12 triangles of an axis-aligned box from the origin, wound outwards. */
function boxTriangles([x, y, z]: Vec): [Vec, Vec, Vec][] {
  const p = (i: number): Vec => [i & 1 ? x : 0, i & 2 ? y : 0, i & 4 ? z : 0];
  const quads = [
    [0, 2, 3, 1], // bottom (z = 0, facing down)
    [4, 5, 7, 6], // top
    [0, 1, 5, 4], // y = 0
    [2, 6, 7, 3], // y = max
    [0, 4, 6, 2], // x = 0
    [1, 3, 7, 5], // x = max
  ];
  return quads.flatMap(([a, b, c, d]) => [
    [p(a), p(b), p(c)],
    [p(a), p(c), p(d)],
  ]);
}

/** Binary STL of a box (millimetres). */
export function boxStl(size: Vec): ArrayBuffer {
  const triangles = boxTriangles(size);
  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((triangle, t) => {
    triangle.flat().forEach((value, i) => view.setFloat32(84 + t * 50 + 12 + i * 4, value, true));
  });
  return buffer;
}

/** 3MF package with one colored box object per entry. */
export function boxes3mf(boxes: { size: Vec; color: string }[]): ArrayBuffer {
  const objects = boxes
    .map(({ size }, index) => {
      const triangles = boxTriangles(size);
      const vertices = triangles
        .flat()
        .map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`)
        .join('');
      const faces = triangles
        .map((_, t) => `<triangle v1="${t * 3}" v2="${t * 3 + 1}" v3="${t * 3 + 2}"/>`)
        .join('');
      return (
        `<object id="${index + 2}" type="model" pid="1" pindex="${index}">` +
        `<mesh><vertices>${vertices}</vertices><triangles>${faces}</triangles></mesh></object>`
      );
    })
    .join('');
  const materials = boxes
    .map(({ color }, index) => `<base name="part-${index}" displaycolor="${color}FF"/>`)
    .join('');
  const items = boxes.map((_, index) => `<item objectid="${index + 2}"/>`).join('');
  const model =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
    `<resources><basematerials id="1">${materials}</basematerials>${objects}</resources>` +
    `<build>${items}</build></model>`;
  const zip = zipSync({
    '[Content_Types].xml': bytes(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
    ),
    '_rels/.rels': bytes(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
    ),
    '3D/3dmodel.model': bytes(model),
  });
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;
}
