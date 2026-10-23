import type { EditorDoc } from '../editor/model';
import { layersToMm, printedGroups, type PrintSettings } from '../lib/printPlan';

interface LayerProfileProps {
  doc: EditorDoc;
  settings: PrintSettings;
  /** Height above the base per printed color, in layers (`heightPlan().colors`). */
  colors: Map<number, number>;
  /** Height of the whole model, in layers (`heightPlan().totalLayers`). */
  totalLayers: number;
}

const WIDTH = 300;
const HEIGHT = 64;

/**
 * The print from the side: the base plate and one column per color at its height, so
 * steps, raised colors and an inlay's flat top show at a glance. Cut-out prints are one
 * plate with holes, so they have none.
 */
export function LayerProfile({ doc, settings, colors, totalLayers }: LayerProfileProps) {
  const groups = printedGroups(doc, settings);
  if (settings.style === 'cutout' || !groups.length || totalLayers <= 0) return null;
  const mm = (layers: number) => layersToMm(layers, settings.layerMm);
  const scale = HEIGHT / totalLayers;
  const column = WIDTH / groups.length;
  const base = settings.baseLayers * scale;
  const label = groups
    .map((group) => `${group.fill} ${mm(colors.get(group.paletteIndex) ?? 0)} mm`)
    .join(', ');
  return (
    <figure className="layer-profile">
      <figcaption className="hint">
        Side view · {mm(totalLayers)} mm{settings.baseLayers > 0 && ' · gray: base plate'}
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Side view: base ${mm(settings.baseLayers)} mm, then ${label}`}
      >
        {base > 0 && (
          <rect className="layer-profile__base" y={HEIGHT - base} width={WIDTH} height={base}>
            <title>Base plate: {mm(settings.baseLayers)} mm</title>
          </rect>
        )}
        {groups.map((group, position) => {
          const layers = colors.get(group.paletteIndex) ?? 0;
          // Inlaid colors sink into the plate from the top; others stand on it.
          const top = settings.inlay ? 0 : HEIGHT - base - layers * scale;
          return (
            <rect
              key={group.paletteIndex}
              className="layer-profile__color"
              x={position * column}
              y={top}
              width={column}
              height={layers * scale}
              fill={group.fill}
            >
              <title>
                {group.fill}: {mm(layers)} mm
              </title>
            </rect>
          );
        })}
      </svg>
    </figure>
  );
}
