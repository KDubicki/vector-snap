import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { errorMessage } from '../api/client';
import {
  FILAMENTS,
  formatMillimetres,
  meshVolume,
  solidWeight,
  type Filament,
} from '../lib/meshStats';

/** A model to show: 3MF keeps the color parts, STL (lithophane) is one plain part. */
export interface PreviewRequest {
  kind: '3mf' | 'stl';
  load: (signal: AbortSignal) => Promise<Blob>;
}

/** Light, slightly warm plastic: the usual white filament for lithophanes. */
const STL_COLOR = 0xf1ede4;

function parseModel(kind: PreviewRequest['kind'], buffer: ArrayBuffer): THREE.Group {
  if (kind === '3mf') return new ThreeMFLoader().parse(buffer);
  const material = new THREE.MeshStandardMaterial({ color: STL_COLOR, roughness: 0.8 });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new STLLoader().parse(buffer), material));
  return group;
}

interface ModelStats {
  size: [number, number, number];
  volume: number;
  parts: number;
  triangles: number;
}

/** Statistics in model coordinates (millimetres, z up) before the view rotation. */
function measure(model: THREE.Object3D): ModelStats {
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

function dispose(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}

/**
 * Interactive 3D preview of the model the backend exports (3MF so each color part keeps
 * its color, or a lithophane STL), with size, volume and filament estimate. Loaded lazily.
 */
export default function ModelPreview({ request }: { request: PreviewRequest }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [filament, setFilament] = useState<Filament>('PLA');

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const controller = new AbortController();

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.domElement.className = 'model-preview__canvas';
    viewport.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x666677, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(1, 2, 1.5);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100_000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // Size from the wrapper (never from the canvas itself, see docs/08 canvas sizing).
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    observer.observe(viewport);
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });

    let model: THREE.Group | null = null;
    request
      .load(controller.signal)
      .then((blob) => blob.arrayBuffer())
      .then((buffer) => {
        if (controller.signal.aborted) return;
        model = parseModel(request.kind, buffer);
        setStats(measure(model));

        // 3MF and STL are z-up, three.js is y-up: lay the model on the build plate.
        model.rotation.x = -Math.PI / 2;
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.set(-center.x, -box.min.y, -center.z);
        scene.add(model);

        const size = box.getSize(new THREE.Vector3());
        const extent = Math.max(size.x, size.z, 1);
        const grid = new THREE.GridHelper(extent * 1.4, 14, 0x888888, 0x444444);
        scene.add(grid);
        camera.position.set(extent * 0.7, extent * 0.9, extent * 1.1);
        controls.target.set(0, size.y / 2, 0);
        controls.update();
        setStatus('ready');
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(caught, 'Preview failed'));
        setStatus('error');
      });

    return () => {
      controller.abort();
      observer.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      if (model) dispose(model);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [request]);

  return (
    <div className="model-preview">
      <div ref={viewportRef} className="model-preview__viewport" aria-label="3D preview">
        {status === 'loading' && <span className="model-preview__status">Building model…</span>}
        {status === 'error' && (
          <span className="model-preview__status field-error" role="alert">
            {error}
          </span>
        )}
      </div>
      {stats && (
        <dl className="stats model-preview__stats">
          <dt>Size</dt>
          <dd>{stats.size.map(formatMillimetres).join(' × ')} mm</dd>
          <dt>Volume</dt>
          <dd>{(stats.volume / 1000).toFixed(1)} cm³</dd>
          <dt>
            <label htmlFor="preview-filament">Filament</label>
          </dt>
          <dd>
            <select
              id="preview-filament"
              value={filament}
              onChange={(event) => setFilament(event.target.value as Filament)}
            >
              {Object.keys(FILAMENTS).map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>{' '}
            ≈ {solidWeight(stats.volume, filament).toFixed(0)} g solid
          </dd>
          <dt>Parts</dt>
          <dd>
            {stats.parts} · {stats.triangles.toLocaleString()} triangles
          </dd>
        </dl>
      )}
      <p className="hint">Drag to rotate · scroll to zoom · right-drag to pan</p>
    </div>
  );
}
