import { describe, expect, it } from 'vitest';
import { formatArea, formatLength, fromUnit, parseLength, toUnit } from '../src/model/units';

describe('parseLength', () => {
  it('reads bare numbers in the current unit', () => {
    expect(parseLength('2.4', 'm')).toBeCloseTo(2.4);
    expect(parseLength('240', 'cm')).toBeCloseTo(2.4);
    expect(parseLength('8', 'ft')).toBeCloseTo(2.4384);
  });

  it('honours explicit suffixes regardless of current unit', () => {
    expect(parseLength('1200 mm', 'm')).toBeCloseTo(1.2);
    expect(parseLength('90cm', 'ft')).toBeCloseTo(0.9);
    expect(parseLength('36in', 'm')).toBeCloseTo(0.9144);
    expect(parseLength('3m', 'cm')).toBeCloseTo(3);
  });

  it('parses feet and inches', () => {
    expect(parseLength(`8' 6"`, 'm')).toBeCloseTo(2.5908);
    expect(parseLength('10ft', 'm')).toBeCloseTo(3.048);
  });

  it('accepts comma decimals and rejects garbage', () => {
    expect(parseLength('2,5', 'm')).toBeCloseTo(2.5);
    expect(parseLength('', 'm')).toBeNull();
    expect(parseLength('abc', 'm')).toBeNull();
    expect(parseLength('1..2', 'm')).toBeNull();
  });
});

describe('formatting', () => {
  it('formats lengths per unit system', () => {
    expect(formatLength(2.4, 'm')).toBe('2.40 m');
    expect(formatLength(2.4, 'cm')).toBe('240 cm');
    expect(formatLength(0.3048 * 8.5, 'ft')).toBe('8′ 6″');
    expect(formatLength(NaN, 'm')).toBe('–');
  });

  it('formats areas', () => {
    expect(formatArea(12, 'm')).toBe('12.00 m²');
    expect(formatArea(1, 'ft')).toBe('10.8 ft²');
  });

  it('round-trips input conversions', () => {
    for (const u of ['m', 'cm', 'ft'] as const) expect(fromUnit(toUnit(1.234, u), u)).toBeCloseTo(1.234, 3);
  });
});
