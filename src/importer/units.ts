// Drawing units and wall-layer detection.
import type { CadDrawing } from './cadTypes';
import { dist } from '../geometry/math';
import { type Line, toPlan, WALL_LAYER_RE } from './shared';
import { pairWalls } from './walls';

export const UNIT_SCALES: { label: string; scale: number; insunits: number }[] = [
  { label: 'Metres', scale: 1, insunits: 6 },
  { label: 'Centimetres', scale: 0.01, insunits: 5 },
  { label: 'Millimetres', scale: 0.001, insunits: 4 },
  { label: 'Inches', scale: 0.0254, insunits: 1 },
  { label: 'Feet', scale: 0.3048, insunits: 2 },
];

/**
 * Layers that look like walls by name. If none match, score each layer by how much
 * of its linework forms wall-like parallel pairs (double lines 8–50 cm apart).
 */
export function guessWallLayers(d: CadDrawing, scale = 1): string[] {
  const named = d.layers.filter((l) => WALL_LAYER_RE.test(l.name)).map((l) => l.name);
  if (named.length) return named;
  const byLayer = new Map<string, Line[]>();
  for (const s of d.segments) {
    if (s.b && s.b * scale <= 3) continue;
    const l = toPlan(s, scale);
    if (l.len < 0.05) continue;
    const list = byLayer.get(s.layer);
    if (list) list.push(l); else byLayer.set(s.layer, [l]);
  }
  const scored = [...byLayer.entries()].map(([name, lines]) => {
    const total = lines.reduce((sum, l) => sum + l.len, 0);
    const walls = pairWalls(lines, { minThickness: 0.08, maxThickness: 0.5 });
    const paired = walls.reduce((sum, w) => sum + dist(w.a, w.b), 0);
    return { name, paired, ratio: total ? (2 * paired) / total : 0 };
  }).filter((x) => x.paired > 10 && x.ratio > 0.35).sort((a, b) => b.paired - a.paired);
  if (scored.length) return scored.slice(0, 2).map((x) => x.name);
  return d.layers.slice(0, 1).map((l) => l.name);
}

/**
 * Pick the drawing unit. Walls are the strongest cue: double wall lines only
 * pair into plausible walls (7–60 cm thick) at the right scale. The declared
 * unit wins when it does nearly as well; drawing size is the fallback.
 */
export function guessScale(d: CadDrawing, wallLayers: string[]): number {
  const layers = new Set(wallLayers);
  // Prefer loose linework: blocks on wall layers are often appliances placed far away.
  const onLayer = d.segments.filter((s) => layers.has(s.layer));
  const loose = onLayer.filter((s) => !s.b);
  const pick = (loose.length >= 20 ? loose : onLayer)
    .map((s) => ({ s, len: Math.hypot(s.x2 - s.x1, s.y2 - s.y1) }))
    .sort((a, b) => b.len - a.len)
    .slice(0, 3000)
    .map((x) => x.s);
  if (!pick.length) return 1;
  const declared = UNIT_SCALES.find((u) => u.insunits === d.insunits);

  const scores = UNIT_SCALES.map((u) => {
    const lines = pick.map((s) => toPlan(s, u.scale)).filter((l) => l.len > 0.05 && l.len < 200);
    const paired = pairWalls(lines, { minThickness: 0.07, maxThickness: 0.6 }).reduce((sum, w) => sum + dist(w.a, w.b), 0);
    return { u, paired };
  });
  const best = scores.reduce((a, b) => (b.paired > a.paired ? b : a));
  if (best.paired > 2) {
    const dec = declared && scores.find((x) => x.u === declared);
    if (dec && dec.paired >= best.paired * 0.7) return dec.u.scale;
    return best.u.scale;
  }

  // No wall pairs at any scale (single-line drawing): fall back to overall size.
  const xs: number[] = [], ys: number[] = [];
  for (const s of pick) { xs.push(s.x1, s.x2); ys.push(s.y1, s.y2); }
  const extent = (v: number[]) => {
    v.sort((a, b) => a - b);
    return (v[Math.floor(v.length * 0.9)] - v[Math.floor(v.length * 0.1)]) * 1.25;
  };
  const size = Math.max(extent(xs), extent(ys));
  const plausible = (scale: number) => size * scale >= 3 && size * scale <= 300;
  if (declared && plausible(declared.scale)) return declared.scale;
  let fallback = 1, bestScore = Infinity;
  for (const u of UNIT_SCALES) {
    const score = Math.abs(Math.log((size * u.scale) / 15));
    if (score < bestScore) { bestScore = score; fallback = u.scale; }
  }
  return fallback;
}
