import type { ColorGroup } from '../editor/model';
import { POOR_MATCH_DELTA_E, type Filament, type MixMatch } from '../lib/mixing';

interface MixTableProps {
  groups: ColorGroup[];
  plan: Map<number, MixMatch>;
  filaments: Filament[];
}

function Chip({ filament, index, layers }: { filament: Filament; index: number; layers?: number }) {
  return (
    <span className="mix-chip" title={`Filament ${index + 1} (${filament.color})`}>
      <span className="swatch" style={{ background: filament.color }} />
      {layers === undefined ? index + 1 : `${index + 1} × ${layers}`}
    </span>
  );
}

/** Per design color: the predicted print color and the filaments it is layered from. */
export function MixTable({ groups, plan, filaments }: MixTableProps) {
  const poor = [...plan.values()].filter((match) => match.deltaE > POOR_MATCH_DELTA_E).length;

  return (
    <div className="field mix-table">
      <span>Mixed colors</span>
      <ul>
        {groups.map((group) => {
          const match = plan.get(group.paletteIndex);
          if (!match) return null;
          const { recipe } = match;
          return (
            <li key={group.paletteIndex}>
              <span
                className="mix-table__pair"
                title={`Design ${group.fill} → predicted ${match.predicted}`}
              >
                <span className="swatch" style={{ background: group.fill }} />
                <span aria-hidden="true">→</span>
                <span className="swatch" style={{ background: match.predicted }} />
              </span>
              <span className="mix-table__recipe">
                {recipe.top.map((layer) => (
                  <Chip
                    key={layer.filament}
                    filament={filaments[layer.filament]}
                    index={layer.filament}
                    layers={layer.layers}
                  />
                ))}
                {recipe.top.length > 0 && <span className="hint">on</span>}
                <Chip filament={filaments[recipe.base]} index={recipe.base} />
              </span>
              <span
                className={`mix-table__match${match.deltaE > POOR_MATCH_DELTA_E ? ' poor' : ''}`}
                title="Color difference (ΔE): below 2 looks the same, above 10 clearly different"
              >
                ΔE {match.deltaE.toFixed(1)}
              </span>
            </li>
          );
        })}
      </ul>
      <span className="hint">
        Thin layers (filament × layers, from the top) printed on a base filament. Predictions assume
        the TDs above; print a small test to check them.
      </span>
      {poor > 0 && (
        <span className="field-error">
          {poor} {poor === 1 ? 'color' : 'colors'} cannot be mixed well from these filaments — load
          a filament closer to {poor === 1 ? 'it' : 'them'}, or add color layers: thin colors over
          the white base look lighter.
        </span>
      )}
    </div>
  );
}
