/**
 * three.js side of the 3D preview that needs no WebGL: parsing exported models, their
 * statistics, laying them on the build plate and freeing them. See ModelPreview.
 */
import * as THREE from 'three';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { meshVolume } from './meshStats';

export type ModelKind = '3mf' | 'stl';

/** Light, slightly warm plastic: the usual white filament for lithophanes. */
export const STL_COLOR = 0xf1ede4;

/** 3MF keeps its colored parts; an STL (lithophane) becomes one part in STL_COLOR. */
export function parseModel(kind: ModelKind, buffer: ArrayBuffer): THREE.Group {
  if (kind === '3mf') return new ThreeMFLoader().parse(buffer);
  const material = new THREE.MeshStandardMaterial({ color: STL_COLOR, roughness: 0.8 });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new STLLoader().parse(buffer), material));
  return group;
}

export interface ModelStats {
  size: [number, number, number];
  volume: number;
  parts: number;
  triangles: number;
}

/** Statistics in model coordinates (millimetres, z up) before the view rotation. */
export function measure(model: THREE.Object3D): ModelStats {
  model.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  let volume = 0;
  let parts = 0;
  let triangles = 0;
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = (object.geometry as THREE.BufferGeometry).clone();
    geometry.applyMatrix4(object.matrixWorld);
    const index = geometry.getIndex();
    volume += meshVolume(geometry.getAttribute('position').array, index ? index.array : null);
    triangles += (index ? index.count : geometry.getAttribute('position').count) / 3;
    parts += 1;
    geometry.dispose();
  });
  return { size: [size.x, size.y, size.z], volume, parts, triangles };
}

/**
 * Lay a z-up model (3MF/STL) on the y-up three.js build plate, centered; returns its size
 * in view coordinates (y is the height).
 */
export function placeOnPlate(model: THREE.Object3D): THREE.Vector3 {
  model.rotation.x = -Math.PI / 2;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -box.min.y, -center.z);
  model.updateMatrixWorld(true);
  return box.getSize(new THREE.Vector3());
}

/** Free the geometries and materials of a model. */
export function disposeModel(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}
