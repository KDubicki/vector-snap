import { useState, type PointerEvent } from 'react';
import { comparePosition } from '../lib/compare';

interface CompareViewProps {
  originalUrl: string;
  resultUrl: string;
  width: number;
  height: number;
}

/** Original image and SVG result on top of each other, split by a draggable divider. */
export function CompareView({ originalUrl, resultUrl, width, height }: CompareViewProps) {
  const [position, setPosition] = useState(50);

  const follow = (event: PointerEvent<HTMLDivElement>) => {
    setPosition(comparePosition(event.clientX, event.currentTarget.getBoundingClientRect()));
  };

  return (
    <div className="compare">
      <div className="compare__viewport checkerboard">
        <div
          className="compare__stage"
          // As large as fits the viewport height while keeping the image's aspect ratio, so
          // the divider position is relative to the image itself.
          style={{
            aspectRatio: `${width} / ${height}`,
            width: `min(100%, calc(var(--compare-max-height) * ${width / height}))`,
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            follow(event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) follow(event);
          }}
        >
          <img src={resultUrl} alt="SVG result" draggable={false} />
          <img
            src={originalUrl}
            alt="Original image"
            draggable={false}
            style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
          />
          <div className="compare__divider" style={{ left: `${position}%` }} aria-hidden="true">
            <span className="compare__handle" />
          </div>
          <span className="compare__label compare__label--left">Original</span>
          <span className="compare__label compare__label--right">SVG</span>
        </div>
      </div>
      <label className="compare__slider">
        <span className="visually-hidden">Divider position</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(position)}
          aria-valuetext={`${Math.round(position)}% original`}
          onChange={(event) => setPosition(event.target.valueAsNumber)}
        />
      </label>
      <p className="hint">Drag across the image or use the slider to compare.</p>
    </div>
  );
}
