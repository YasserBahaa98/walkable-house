// Colour helpers for canvas drawing (theme colours come from CSS custom properties).

/** Parse #rgb, #rrggbb or rgb()/rgba() (CSS minifiers shorten theme colours). */
export function hex(c: string): [number, number, number] {
  const v = c.trim();
  const short = v.match(/^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (short) return [1, 2, 3].map((i) => parseInt(short[i] + short[i], 16)) as [number, number, number];
  const long = v.match(/^#?([0-9a-f]{6})$/i);
  if (long) {
    const n = parseInt(long[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];
  return [128, 128, 128];
}
export function withAlpha(c: string, a: number) {
  const [r, g, b] = hex(c);
  return `rgba(${r},${g},${b},${a})`;
}
export function mix(a: string, b: string, t: number) {
  const A = hex(a), B = hex(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
}
