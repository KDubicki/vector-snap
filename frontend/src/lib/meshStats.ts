/**
 * Print statistics for the 3D preview: volume and filament weight of triangle meshes.
 * Units: millimetres (mm³ for volume), grams for weight.
 */

/** Filament densities in g/cm³ (typical manufacturer values). */
export const FILAMENTS = {
  PLA: 1.24,
  PETG: 1.27,
  ABS: 1.04,
  TPU: 1.21,
} as const;

export type Filament = keyof typeof FILAMENTS;

/**
 * Volume enclosed by a closed triangle mesh (signed tetrahedron sum).
 * `positions` holds x, y, z per vertex; `index` (optional) three vertex indices per face.
 */
export function meshVolume(
  positions: ArrayLike<number>,
  index: ArrayLike<number> | null = null,
): number {
  const faces = index ? index.length / 3 : positions.length / 9;
  const vertex = (face: number, corner: number) => {
    const i = (index ? index[face * 3 + corner] : face * 3 + corner) * 3;
    return [positions[i], positions[i + 1], positions[i + 2]];
  };
  let sum = 0;
  for (let face = 0; face < faces; face += 1) {
    const [ax, ay, az] = vertex(face, 0);
    const [bx, by, bz] = vertex(face, 1);
    const [cx, cy, cz] = vertex(face, 2);
    sum += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return sum / 6;
}

/** Weight of a solid (100 % infill) print in grams — an upper bound for slicer estimates. */
export function solidWeight(volumeMm3: number, filament: Filament): number {
  return (volumeMm3 / 1000) * FILAMENTS[filament];
}

export function formatMillimetres(value: number): string {
  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}
