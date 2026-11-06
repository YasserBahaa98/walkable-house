// Stairs from stair blocks or evenly spaced tread lines.
import type { Stair, Vec2 } from '../model/types';
import { uid } from '../model/ids';
import { dist, round3 as round } from '../geometry/math';
import { angDiff, DOWN_RE, type Hint, type Line, UP_RE } from './shared';

export function detectStairs(blocks: Hint[], lines: Line[], texts: { text: string; p: Vec2 }[]): { stair: Stair; fromAbove: boolean }[] {
  const out: { stair: Stair; fromAbove: boolean }[] = [];
  const hint = (c: Vec2) => {
    const near = texts.filter((t) => dist(t.p, c) < 4);
    const up = near.filter((t) => UP_RE.test(t.text.trim()));
    const down = near.filter((t) => DOWN_RE.test(t.text.trim()));
    return { up: up[0]?.p, down: down[0]?.p };
  };
  const make = (c: Vec2, dir: Vec2, width: number, length: number) => {
    const h = hint(c);
    let dx = dir.x, dz = dir.z;
    // Start the climb at the end nearest an "UP" label (or furthest from "DOWN").
    const label = h.up ?? h.down;
    if (label) {
      const along = (label.x - c.x) * dx + (label.z - c.z) * dz;
      const startNearLabel = !!h.up;
      if ((along > 0) === startNearLabel) { dx = -dx; dz = -dz; }
    }
    out.push({
      stair: { id: uid('s'), x: round(c.x), z: round(c.z), rot: Math.atan2(dx, dz), width: round(width), length: round(length) },
      fromAbove: !h.up && !!h.down,
    });
  };

  for (const b of blocks) {
    const long = Math.max(b.wm, b.hm), short = Math.min(b.wm, b.hm);
    if (long < 1.2 || short < 0.6) continue;
    // CAD local X axis in plan coordinates.
    const ax = { x: Math.cos(b.angle), z: -Math.sin(b.angle) };
    const l = lShapedStair(b.p, ax, b.wm / 2, b.hm / 2, lines, hint(b.p).up);
    if (l) { out.push({ stair: l, fromAbove: false }); continue; }
    const dir = b.wm >= b.hm ? ax : { x: -ax.z, z: ax.x };
    make(b.p, dir, short, long);
  }

  // Treads: >= 6 parallel lines of equal length, evenly spaced 0.2–0.4 m apart.
  const cand = lines.filter((l) => l.len >= 0.6 && l.len <= 2.0);
  const used = new Set<Line>();
  for (const seed of cand) {
    if (used.has(seed)) continue;
    const group = cand.filter((l) => !used.has(l) && angDiff(l.ang, seed.ang) < 0.03 && Math.abs(l.len - seed.len) < 0.08);
    const mid = (l: Line) => ({ x: (l.a.x + l.b.x) / 2, z: (l.a.z + l.b.z) / 2 });
    const m0 = mid(seed);
    const nx = -seed.uz, nz = seed.ux;
    const aligned = group
      .map((l) => ({ l, m: mid(l) }))
      .filter(({ m }) => Math.abs((m.x - m0.x) * seed.ux + (m.z - m0.z) * seed.uz) < 0.15)
      .map((x) => ({ ...x, t: (x.m.x - m0.x) * nx + (x.m.z - m0.z) * nz }))
      .sort((a, b) => a.t - b.t);
    // Find the longest evenly spaced run.
    let best: typeof aligned = [];
    for (let i = 0; i < aligned.length; i++) {
      const run = [aligned[i]];
      for (let j = i + 1; j < aligned.length; j++) {
        const gap = aligned[j].t - run[run.length - 1].t;
        if (gap < 0.15) continue;
        if (gap > 0.45) break;
        if (run.length > 1) {
          const step = run[1].t - run[0].t;
          if (Math.abs(gap - step) > 0.04) break;
        }
        run.push(aligned[j]);
      }
      if (run.length > best.length) best = run;
    }
    if (best.length < 6) continue;
    best.forEach((x) => used.add(x.l));
    const step = (best[best.length - 1].t - best[0].t) / (best.length - 1);
    const length = best[best.length - 1].t - best[0].t + step;
    const tMid = (best[0].t + best[best.length - 1].t) / 2;
    const c = { x: m0.x + nx * tMid, z: m0.z + nz * tMid };
    if (out.some((o) => dist({ x: o.stair.x, z: o.stair.z }, c) < 1.2)) continue;
    make(c, { x: nx, z: nz }, seed.len, length);
  }
  return out;
}

/**
 * Recognise an L-shaped stair inside a rectangular footprint from its treads:
 * two groups of parallel lines at right angles, one per flight.
 */
export function lShapedStair(c: Vec2, ax: Vec2, hu: number, hv: number, lines: Line[], up?: Vec2): Stair | null {
  const av = { x: -ax.z, z: ax.x };
  const loc = (p: Vec2) => ({ u: (p.x - c.x) * ax.x + (p.z - c.z) * ax.z, v: (p.x - c.x) * av.x + (p.z - c.z) * av.z });
  const inside = (p: Vec2) => { const q = loc(p); return Math.abs(q.u) <= hu + 0.05 && Math.abs(q.v) <= hv + 0.05; };
  const angU = Math.atan2(ax.z, ax.x);
  const norm = (a: number) => (a < 0 ? a + Math.PI : a >= Math.PI ? a - Math.PI : a);
  const treads = lines.filter((l) => l.len >= 0.4 && l.len <= 2.2 && inside(l.a) && inside(l.b));
  // Keep each group's dominant tread length (drops outlines, walking lines and nosing edges).
  const dominant = (g: Line[]) => {
    const counts = new Map<number, number>();
    for (const l of g) { const k = Math.round(l.len / 0.05); counts.set(k, (counts.get(k) ?? 0) + 1); }
    let mode = 0, best = 0;
    for (const [k, n] of counts) if (n > best || (n === best && k > mode)) { best = n; mode = k; }
    return g.filter((l) => Math.abs(l.len - mode * 0.05) <= 0.06);
  };
  const gU = dominant(treads.filter((l) => angDiff(l.ang, norm(angU)) < 0.05));           // treads along u: climbs along v
  const gV = dominant(treads.filter((l) => angDiff(l.ang, norm(angU + Math.PI / 2)) < 0.05));
  if (gU.length < 3 || gV.length < 3) return null;
  const box = (g: Line[]) => {
    const pts = g.flatMap((l) => [loc(l.a), loc(l.b)]);
    const u0 = Math.min(...pts.map((p) => p.u)), u1 = Math.max(...pts.map((p) => p.u));
    const v0 = Math.min(...pts.map((p) => p.v)), v1 = Math.max(...pts.map((p) => p.v));
    return { cu: (u0 + u1) / 2, cv: (v0 + v1) / 2, wu: u1 - u0, wv: v1 - v0 };
  };
  const bU = box(gU), bV = box(gV);
  // Flight along v (treads ∥ u) vs flight along u (treads ∥ v). The first flight is the one by the UP label, else the longer run.
  const runU = bU.wv, runV = bV.wu;
  let firstIsU = runU >= runV;
  if (up && Math.max(runU, runV) < 1.3 * Math.min(runU, runV)) {
    const q = loc(up);
    firstIsU = Math.hypot(q.u - bU.cu, q.v - bU.cv) <= Math.hypot(q.u - bV.cu, q.v - bV.cv);
  }
  const f1 = firstIsU ? bU : bV, f2 = firstIsU ? bV : bU;
  const width = firstIsU ? f1.wu : f1.wv;
  // Climb axis of each flight in local (u, v), signed from the first flight towards the second.
  const axis1 = firstIsU ? { u: 0, v: 1 } : { u: 1, v: 0 };
  const axis2 = firstIsU ? { u: 1, v: 0 } : { u: 0, v: 1 };
  const s1 = Math.sign((f2.cu - f1.cu) * axis1.u + (f2.cv - f1.cv) * axis1.v) || 1;
  const s2 = Math.sign((f2.cu - f1.cu) * axis2.u + (f2.cv - f1.cv) * axis2.v) || 1;
  const toWorld = (a: { u: number; v: number }, sg: number) => ({ x: (ax.x * a.u + av.x * a.v) * sg, z: (ax.z * a.u + av.z * a.v) * sg });
  const d1 = toWorld(axis1, s1), d2 = toWorld(axis2, s2);
  const extent1 = 2 * (firstIsU ? hv : hu), extent2 = 2 * (firstIsU ? hu : hv);
  const right = { x: -d1.z, z: d1.x };
  return {
    id: uid('s'), x: round(c.x), z: round(c.z), rot: Math.atan2(d1.x, d1.z),
    width: round(Math.max(0.6, width)),
    length: round(Math.max(0.6, extent1 - width)),
    shape: 'L',
    turn: d2.x * right.x + d2.z * right.z > 0 ? 'right' : 'left',
    length2: round(Math.max(0.6, extent2 - width)),
  };
}