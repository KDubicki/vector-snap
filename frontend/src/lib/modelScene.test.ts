// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { boxStl, boxes3mf } from '../test/models';
import { STL_COLOR, disposeModel, measure, parseModel, placeOnPlate } from './modelScene';

describe('model scene', () => {
  it('parses an STL as one light part and measures it', () => {
    const model = parseModel('stl', boxStl([10, 20, 5]));
    const stats = measure(model);

    expect(stats.parts).toBe(1);
    expect(stats.triangles).toBe(12);
    expect(stats.size).toEqual([10, 20, 5]);
    expect(stats.volume).toBeCloseTo(1000);
    const mesh = model.children[0] as THREE.Mesh;
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(STL_COLOR);
  });

  it('parses a 3MF with its colored parts', () => {
    const model = parseModel(
      '3mf',
      boxes3mf([
        { size: [10, 10, 2], color: '#FFFFFF' },
        { size: [4, 4, 3], color: '#FF0000' },
      ]),
    );
    const stats = measure(model);

    expect(stats.parts).toBe(2);
    expect(stats.volume).toBeCloseTo(200 + 48);
    expect(stats.size).toEqual([10, 10, 3]);
  });

  it('lays a z-up model on the plate, centered, and frees it', () => {
    const model = parseModel('stl', boxStl([10, 20, 5]));

    const size = placeOnPlate(model);
    expect(size.toArray().map((v) => Math.round(v))).toEqual([10, 5, 20]); // y is the height
    const box = new THREE.Box3().setFromObject(model);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.getCenter(new THREE.Vector3()).x).toBeCloseTo(0);
    expect(box.getCenter(new THREE.Vector3()).z).toBeCloseTo(0);

    const mesh = model.children[0] as THREE.Mesh;
    let disposed = 0;
    mesh.geometry.addEventListener('dispose', () => (disposed += 1));
    (mesh.material as THREE.Material).addEventListener('dispose', () => (disposed += 1));
    disposeModel(model);
    expect(disposed).toBe(2);
  });
});
