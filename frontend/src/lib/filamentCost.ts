/**
 * Filament cost of a print: the price of a kilogram of filament, kept in this browser,
 * times the solid model and the filament purged at color changes. See docs/07-frontend.md.
 */

export const FILAMENT_PRICE_KEY = 'vectorsnap.filament-price';
/** Highest price per kilogram taken (any currency). */
export const MAX_PRICE = 100_000;

/** Cost of `grams` of filament at `pricePerKg`. */
export function filamentCost(grams: number, pricePerKg: number): number {
  return (grams / 1000) * pricePerKg;
}

/** Two decimals, with "< 0.01" for prints that cost next to nothing. */
export function formatCost(cost: number): string {
  if (cost > 0 && cost < 0.005) return '< 0.01';
  return cost.toFixed(2);
}

export function validPrice(price: number): boolean {
  return Number.isFinite(price) && price > 0 && price <= MAX_PRICE;
}

/** The remembered price per kilogram; null when none (or an invalid one) is stored. */
export function readFilamentPrice(storage: Pick<Storage, 'getItem'> | undefined): number | null {
  try {
    const price = Number(storage?.getItem(FILAMENT_PRICE_KEY) ?? Number.NaN);
    return validPrice(price) ? price : null;
  } catch {
    return null;
  }
}

/** Remember the price per kilogram; null forgets it. */
export function saveFilamentPrice(
  storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined,
  price: number | null,
): void {
  try {
    if (price === null) storage?.removeItem(FILAMENT_PRICE_KEY);
    else storage?.setItem(FILAMENT_PRICE_KEY, String(price));
  } catch {
    // Not remembered; the cost still shows on this page.
  }
}
