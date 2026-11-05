import type { Units } from './types';

const FT = 0.3048;

/** Format a length (metres) for display in the chosen unit system. */
export function formatLength(m: number, units: Units, precise = false): string {
  if (!Number.isFinite(m)) return '–';
  switch (units) {
    case 'cm':
      return `${Math.round(m * 100)} cm`;
    case 'ft': {
      const totalIn = Math.round((m / FT) * 12 * (precise ? 4 : 1)) / (precise ? 4 : 1);
      const ft = Math.floor(totalIn / 12);
      const inch = +(totalIn - ft * 12).toFixed(2);
      return inch ? `${ft}′ ${inch}″` : `${ft}′`;
    }
    default:
      return `${m.toFixed(precise ? 3 : 2)} m`;
  }
}

export function formatArea(m2: number, units: Units): string {
  if (units === 'ft') return `${(m2 / (FT * FT)).toFixed(1)} ft²`;
  return `${m2.toFixed(2)} m²`;
}

/** Value shown in a numeric input for the given unit. */
export function toUnit(m: number, units: Units): number {
  if (units === 'cm') return Math.round(m * 1000) / 10;
  if (units === 'ft') return Math.round((m / FT) * 1000) / 1000;
  return Math.round(m * 1000) / 1000;
}

export function fromUnit(v: number, units: Units): number {
  if (units === 'cm') return v / 100;
  if (units === 'ft') return v * FT;
  return v;
}

export const unitLabel = (u: Units) => (u === 'ft' ? 'ft' : u);

/**
 * Parse free-form length input such as "2.4", "240cm", "8ft", "8' 6\"" or "1200 mm".
 * Bare numbers are interpreted in `units`. Returns metres or null if invalid.
 */
export function parseLength(input: string, units: Units): number | null {
  const s = input.trim().toLowerCase().replace(',', '.');
  if (!s) return null;
  const ftIn = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:'|′|ft)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|″|in)?)?$/);
  if (ftIn) return (+ftIn[1] + (ftIn[2] ? +ftIn[2] / 12 : 0)) * FT;
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(mm|cm|m|in|"|″)?$/);
  if (!m) return null;
  const v = +m[1];
  switch (m[2]) {
    case 'mm': return v / 1000;
    case 'cm': return v / 100;
    case 'm': return v;
    case 'in': case '"': case '″': return v * 0.0254;
    default: return fromUnit(v, units);
  }
}
