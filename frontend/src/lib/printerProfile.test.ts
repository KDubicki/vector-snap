import { describe, expect, it } from 'vitest';
import { DEFAULT_PRINT } from './printPlan';
import {
  DEFAULT_PRINTER,
  PRINTER_KEY,
  printerOf,
  readPrinter,
  savePrinter,
  tuningChanged,
} from './printerProfile';

function memoryStorage(data: Record<string, string> = {}) {
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

describe('printer profile', () => {
  it('saves and reads back the printer part of the print settings', () => {
    const storage = memoryStorage();
    const settings = {
      ...DEFAULT_PRINT,
      widthMm: 50,
      nozzleMm: 0.6,
      elephantFootMm: 0.2,
      filaments: [{ color: '#FFFFFF', td: 3 }],
    };

    savePrinter(storage, printerOf(settings));

    expect(Object.keys(JSON.parse(storage.data[PRINTER_KEY]))).not.toContain('widthMm');
    expect(readPrinter(storage)).toEqual({
      nozzleMm: 0.6,
      elephantFootMm: 0.2,
      simplifyMm: 0,
      colorGapMm: 0,
      filaments: [{ color: '#ffffff', td: 3 }],
    });
  });

  it('reads missing, broken or out of range data as the defaults', () => {
    expect(readPrinter(undefined)).toEqual(DEFAULT_PRINTER);
    expect(readPrinter(memoryStorage())).toEqual(DEFAULT_PRINTER);
    expect(readPrinter(memoryStorage({ [PRINTER_KEY]: '{not json' }))).toEqual(DEFAULT_PRINTER);
    const bad = {
      nozzleMm: -1,
      elephantFootMm: 3,
      simplifyMm: '0.1',
      colorGapMm: 0.1,
      filaments: [
        { color: 'red', td: 3 },
        { color: '#000000', td: 0 },
        null,
        { color: '#111111', td: 2 },
      ],
    };
    expect(readPrinter(memoryStorage({ [PRINTER_KEY]: JSON.stringify(bad) }))).toEqual({
      ...DEFAULT_PRINTER,
      colorGapMm: 0.1,
      filaments: [{ color: '#111111', td: 2 }],
    });
  });

  it('keeps at most one AMS of filaments', () => {
    const filaments = Array.from({ length: 6 }, () => ({ color: '#222222', td: 1 }));
    const storage = memoryStorage({ [PRINTER_KEY]: JSON.stringify({ filaments }) });
    expect(readPrinter(storage).filaments).toHaveLength(4);
  });

  it('ignores storage that throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(readPrinter(throwing)).toEqual(DEFAULT_PRINTER);
    expect(() => savePrinter(throwing, DEFAULT_PRINTER)).not.toThrow();
  });

  it('counts the changed nozzle and tuning settings', () => {
    expect(tuningChanged(DEFAULT_PRINT)).toBe(0);
    expect(tuningChanged({ ...DEFAULT_PRINT, nozzleMm: 0.6, simplifyMm: 0.1 })).toBe(2);
    expect(tuningChanged({ ...DEFAULT_PRINT, filaments: [{ color: '#ffffff', td: 3 }] })).toBe(0);
  });
});
