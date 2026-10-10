import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { errorMessage } from '../api/client';
import { formatElapsed, useElapsedSeconds } from '../lib/elapsed';
import { FILAMENTS, formatMillimetres, solidWeight, type Filament } from '../lib/meshStats';
import {
  disposeModel,
  measure,
  parseModel,
  placeOnPlate,
  type ModelKind,
  type ModelStats,
} from '../lib/modelScene';

/** A model to show: 3MF keeps the color parts, STL (lithophane) is one plain part. */
export interface PreviewRequest {
  kind: ModelKind;
  load: (signal: AbortSignal) => Promise<Blob>;
}

/**
 * Interactive 3D preview of the model the backend exports (3MF so each color part keeps
 * its color, or a lithophane STL), with size, volume and filament estimate. Loaded lazily.
 */
export default function ModelPreview({
  request,
  onCancel,
}: {
  request: PreviewRequest;
  /** Closes the preview; unmounting aborts the request. */
  onCancel: () => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [filament, setFilament] = useState<Filament>('PLA');
  const elapsed = formatElapsed(useElapsedSeconds(status === 'loading'));

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
        const size = placeOnPlate(model);
        scene.add(model);

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
      if (model) disposeModel(model);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [request]);

  return (
    <div className="model-preview">
      <div ref={viewportRef} className="model-preview__viewport" aria-label="3D preview">
        {status === 'loading' && (
          <div className="model-preview__status" role="status">
            <span>
              Building model…{elapsed && ` ${elapsed}`}
              {elapsed && (
                <span className="hint">Large or detailed designs can take a minute.</span>
              )}
            </span>
            <button type="button" className="secondary" onClick={onCancel}>
              Cancel
            </button>
          </div>
        )}
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
