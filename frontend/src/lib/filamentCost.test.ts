import { describe, expect, it } from 'vitest';
import {
  FILAMENT_PRICE_KEY,
  filamentCost,
  formatCost,
  readFilamentPrice,
  saveFilamentPrice,
} from './filamentCost';

describe('filament cost', () => {
  it('prices grams of filament per kilogram', () => {
    expect(filamentCost(250, 80)).toBe(20);
    expect(formatCost(filamentCost(9.9, 79.99))).toBe('0.79');
    expect(formatCost(filamentCost(0.02, 80))).toBe('< 0.01');
    expect(formatCost(0)).toBe('0.00');
  });

  it('remembers a valid price and forgets it', () => {
    const items = new Map<string, string>();
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    };

    expect(readFilamentPrice(storage)).toBeNull();
    saveFilamentPrice(storage, 79.99);
    expect(items.get(FILAMENT_PRICE_KEY)).toBe('79.99');
    expect(readFilamentPrice(storage)).toBe(79.99);
    saveFilamentPrice(storage, null);
    expect(readFilamentPrice(storage)).toBeNull();

    items.set(FILAMENT_PRICE_KEY, '-3');
    expect(readFilamentPrice(storage)).toBeNull();
    expect(readFilamentPrice(undefined)).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readFilamentPrice(broken)).toBeNull();
  });
});
