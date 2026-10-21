import { useState } from 'react';
import {
  MAX_PRICE,
  filamentCost,
  formatCost,
  readFilamentPrice,
  saveFilamentPrice,
  validPrice,
} from '../lib/filamentCost';
import { browserStorage } from '../lib/theme';

interface FilamentCostProps {
  /** Solid filament of the model (grams); undefined while unknown. */
  modelGrams: number | undefined;
  /** Filament purged at color changes (grams). */
  purgeGrams: number;
}

/** The print's filament cost at a price per kilogram remembered in this browser. */
export function FilamentCost({ modelGrams, purgeGrams }: FilamentCostProps) {
  const [price, setPrice] = useState<number | null>(() => readFilamentPrice(browserStorage()));

  const change = (value: number) => {
    const next = validPrice(value) ? value : null;
    setPrice(Number.isFinite(value) ? value : null);
    saveFilamentPrice(browserStorage(), next);
  };

  const cost =
    price !== null && validPrice(price) && modelGrams !== undefined
      ? formatCost(filamentCost(modelGrams + purgeGrams, price))
      : null;

  return (
    <div className="option filament-cost">
      <label htmlFor="filament-price">Filament price per kg</label>
      <div className="print-number">
        <input
          id="filament-price"
          type="number"
          min={0}
          max={MAX_PRICE}
          step={0.01}
          placeholder="e.g. 80"
          value={price ?? ''}
          onChange={(event) => change(event.target.valueAsNumber)}
        />
        {cost !== null && (
          <span className="hint" role="status">
            ≈ <strong>{cost}</strong> for this print
            {purgeGrams > 0 ? ', purge included' : ''}
          </span>
        )}
      </div>
      <span className="hint">
        Any currency; kept in this browser. Solid model, so infill makes it less.
      </span>
    </div>
  );
}
