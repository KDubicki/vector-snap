import { useId } from 'react';
import type { EditorDoc } from '../editor/model';

interface ElementMapProps {
  doc: EditorDoc;
  selected: string[];
  /** Extra layers per shape id. */
  raised: Record<string, number>;
  excluded: number[];
  /** Colors to show instead of the design's, per palette index (predicted print colors). */
  fills?: Map<number, string>;
  /** Outlines along the colors' edges: their color and width in document units. */
  outline?: { color: string; width: number };
  /** Flips the design left to right, as a mirrored print (stamp) comes out. */
  mirror?: boolean;
  /** Printed size of the design (mm), drawn as dimension lines below and to the right. */
  size?: { widthMm: number; heightMm: number };
  /** `additive`: Shift/Ctrl/Cmd click toggles instead of replacing the selection. */
  onSelect: (id: string | null, additive: boolean) => void;
}

/** A length in mm for a dimension label: at most one decimal, none when whole. */
const mmLabel = (value: number) => `${Number(value.toFixed(1))} mm`;

/**
 * Dimension lines with end ticks under and beside a `width` × `height` drawing, labelled
 * with its printed size; `gap` is the room left for them, in drawing units.
 */
function Dimensions({
  width,
  height,
  gap,
  size,
}: {
  width: number;
  height: number;
  gap: number;
  size: { widthMm: number; heightMm: number };
}) {
  const line = height + gap * 0.3;
  const side = width + gap * 0.3;
  const tick = gap * 0.15;
  return (
    <g className="element-map__dimensions" aria-hidden="true" fontSize={gap * 0.38}>
      <path
        d={`M0,${line} H${width} M0,${line - tick} V${line + tick} M${width},${line - tick} V${line + tick}
            M${side},0 V${height} M${side - tick},0 H${side + tick} M${side - tick},${height} H${side + tick}`}
      />
      <text x={width / 2} y={height + gap * 0.85} textAnchor="middle">
        {mmLabel(size.widthMm)}
      </text>
      <text
        x={width + gap * 0.95}
        y={height / 2}
        textAnchor="middle"
        transform={`rotate(-90 ${width + gap * 0.95} ${height / 2})`}
      >
        {mmLabel(size.heightMm)}
      </text>
    </g>
  );
}

/**
 * The design as clickable shapes: select elements to raise them. Raised elements have a
 * dashed outline, selected ones a solid accent outline; left-out colors are faded.
 */
export function ElementMap({
  doc,
  selected,
  raised,
  excluded,
  fills,
  outline,
  mirror = false,
  size,
  onSelect,
}: ElementMapProps) {
  const gap = size ? Math.max(doc.width, doc.height) * 0.08 : 0;
  // A checkerboard under the design only, so the dimension lines sit on the plain panel.
  const checker = useId();
  const square = Math.max(doc.width, doc.height) / 64;
  return (
    <svg
      className="element-map"
      viewBox={`0 0 ${doc.width + gap} ${doc.height + gap}`}
      role="img"
      aria-label="Design: click elements to select them"
      onClick={(event) => {
        if (event.target === event.currentTarget) onSelect(null, false);
      }}
    >
      <defs>
        <pattern id={checker} width={square * 2} height={square * 2} patternUnits="userSpaceOnUse">
          <rect width={square * 2} height={square * 2} className="element-map__checker-light" />
          <rect width={square} height={square} className="element-map__checker-dark" />
          <rect
            x={square}
            y={square}
            width={square}
            height={square}
            className="element-map__checker-dark"
          />
        </pattern>
      </defs>
      <rect width={doc.width} height={doc.height} fill={`url(#${checker})`} pointerEvents="none" />
      <g transform={mirror ? `matrix(-1 0 0 1 ${doc.width} 0)` : undefined}>
        {doc.groups.map((group) =>
          group.shapes.map((shape) => {
            const raise = raised[shape.id] ?? 0;
            const classes = [
              'element-map__shape',
              excluded.includes(group.paletteIndex) && 'element-map__shape--excluded',
              raise > 0 && 'element-map__shape--raised',
              selected.includes(shape.id) && 'element-map__shape--selected',
            ];
            return (
              <path
                key={shape.id}
                d={shape.d}
                fill={fills?.get(group.paletteIndex) ?? shape.fill ?? group.fill}
                className={classes.filter(Boolean).join(' ')}
                onClick={(event) =>
                  onSelect(shape.id, event.shiftKey || event.metaKey || event.ctrlKey)
                }
              >
                <title>
                  {shape.fill ?? group.fill}
                  {raise > 0 ? ` · raised ${raise} layers` : ''}
                </title>
              </path>
            );
          }),
        )}
        {outline && (
          // Where the outlines print, drawn over the colors; clicks go to the shapes below.
          <g
            className="element-map__outline"
            fill="none"
            stroke={outline.color}
            strokeWidth={outline.width}
            strokeLinejoin="round"
            pointerEvents="none"
            aria-hidden="true"
          >
            {doc.groups
              .filter((group) => !excluded.includes(group.paletteIndex))
              .flatMap((group) => group.shapes.map((shape) => <path key={shape.id} d={shape.d} />))}
          </g>
        )}
      </g>
      {size && <Dimensions width={doc.width} height={doc.height} gap={gap} size={size} />}
    </svg>
  );
}
