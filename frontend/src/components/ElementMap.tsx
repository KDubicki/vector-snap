import type { EditorDoc } from '../editor/model';

interface ElementMapProps {
  doc: EditorDoc;
  selected: string[];
  /** Extra layers per shape id. */
  raised: Record<string, number>;
  excluded: number[];
  /** Colors to show instead of the design's, per palette index (predicted print colors). */
  fills?: Map<number, string>;
  /** `additive`: Shift/Ctrl/Cmd click toggles instead of replacing the selection. */
  onSelect: (id: string | null, additive: boolean) => void;
}

/**
 * The design as clickable shapes: select elements to raise them. Raised elements have a
 * dashed outline, selected ones a solid accent outline; left-out colors are faded.
 */
export function ElementMap({ doc, selected, raised, excluded, fills, onSelect }: ElementMapProps) {
  return (
    <svg
      className="element-map checkerboard"
      viewBox={`0 0 ${doc.width} ${doc.height}`}
      role="img"
      aria-label="Design: click elements to select them"
      onClick={(event) => {
        if (event.target === event.currentTarget) onSelect(null, false);
      }}
    >
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
    </svg>
  );
}
