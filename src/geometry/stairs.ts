import type { Level, Stair } from '../model/types';
import { clamp, type Obb, toLocal, toWorld } from './math';

/**
 * A stair is made of sections: flights (which climb along their local +Z) and
 * landings (flat). Straight stairs have one flight; L- and U-shaped stairs have
 * two flights joined by a landing.
 */
export interface StairSection {
  kind: 'flight' | 'landing';
  obb: Obb;
  /** Heights (relative to the stair's base) at the start and end of the section. */
  y0: number;
  y1: number;
  steps: number;
}

/** Vertical rise of a stair: up to the next level, or a sensible default for the top level. */
export function stairRise(level: Level, above: Level | undefined): number {
  return above ? Math.max(0.3, above.elevation - level.elevation) : level.height + 0.2;
}

export function stepCount(rise: number): number {
  return Math.max(2, Math.round(rise / 0.18));
}

const GAP = 0.1; // between the two flights of a U-shaped stair

interface Local { cx: number; cz: number; hx: number; hz: number; rot: number; kind: StairSection['kind']; run: number }

/** Sections in the stair's own frame, before centring (first flight starts at z = 0 and climbs +Z). */
function localSections(s: Stair): Local[] {
  const w = s.width, a = s.length;
  const shape = s.shape ?? 'straight';
  if (shape === 'straight') return [{ kind: 'flight', cx: 0, cz: a / 2, hx: w / 2, hz: a / 2, rot: 0, run: a }];
  const b = s.length2 ?? a;
  // Facing +Z, the walker's right-hand side is -X.
  const dir = (s.turn ?? 'right') === 'right' ? -1 : 1;
  if (shape === 'L') {
    return [
      { kind: 'flight', cx: 0, cz: a / 2, hx: w / 2, hz: a / 2, rot: 0, run: a },
      { kind: 'landing', cx: 0, cz: a + w / 2, hx: w / 2, hz: w / 2, rot: 0, run: 0 },
      { kind: 'flight', cx: dir * (w / 2 + b / 2), cz: a + w / 2, hx: w / 2, hz: b / 2, rot: (dir * Math.PI) / 2, run: b },
    ];
  }
  return [
    { kind: 'flight', cx: 0, cz: a / 2, hx: w / 2, hz: a / 2, rot: 0, run: a },
    { kind: 'landing', cx: (dir * (w + GAP)) / 2, cz: a + w / 2, hx: w + GAP / 2, hz: w / 2, rot: 0, run: 0 },
    { kind: 'flight', cx: dir * (w + GAP), cz: a - b / 2, hx: w / 2, hz: b / 2, rot: Math.PI, run: b },
  ];
}

/** Sections in world coordinates. `stair.x/z` is the centre of the whole footprint. */
export function stairSections(s: Stair, rise = 3): StairSection[] {
  const local = localSections(s);
  // Bounding box of the local footprint (all sections are axis-aligned here).
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const l of local) {
    const ex = Math.abs(Math.cos(l.rot)) * l.hx + Math.abs(Math.sin(l.rot)) * l.hz;
    const ez = Math.abs(Math.sin(l.rot)) * l.hx + Math.abs(Math.cos(l.rot)) * l.hz;
    minX = Math.min(minX, l.cx - ex); maxX = Math.max(maxX, l.cx + ex);
    minZ = Math.min(minZ, l.cz - ez); maxZ = Math.max(maxZ, l.cz + ez);
  }
  const ox = (minX + maxX) / 2, oz = (minZ + maxZ) / 2;
  const frame: Obb = { cx: s.x, cz: s.z, hx: 0, hz: 0, rot: s.rot };

  const n = stepCount(rise);
  const flights = local.filter((l) => l.kind === 'flight');
  const totalRun = flights.reduce((sum, f) => sum + f.run, 0) || 1;
  const n1 = flights.length > 1 ? clamp(Math.round((n * flights[0].run) / totalRun), 1, n - 1) : n;
  const counts = flights.length > 1 ? [n1, n - n1] : [n];
  const riser = rise / n;

  let y = 0, f = 0;
  return local.map((l) => {
    const [cx, cz] = toWorld(frame, l.cx - ox, l.cz - oz);
    const obb: Obb = { cx, cz, hx: l.hx, hz: l.hz, rot: s.rot + l.rot };
    if (l.kind === 'landing') return { kind: 'landing', obb, y0: y, y1: y, steps: 0 };
    const steps = counts[f++];
    const y0 = y;
    y += steps * riser;
    return { kind: 'flight', obb, y0, y1: y, steps };
  });
}

/** Bounding box of the whole stair (for selection and dragging). */
export function stairObb(s: Stair): Obb {
  const secs = stairSections(s);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const sec of secs) {
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const [x, z] = toWorld(sec.obb, sx * sec.obb.hx, sz * sec.obb.hz);
      const [lx, lz] = toLocal({ cx: s.x, cz: s.z, hx: 0, hz: 0, rot: s.rot }, x, z);
      minX = Math.min(minX, lx); maxX = Math.max(maxX, lx); minZ = Math.min(minZ, lz); maxZ = Math.max(maxZ, lz);
    }
  }
  const [cx, cz] = toWorld({ cx: s.x, cz: s.z, hx: 0, hz: 0, rot: s.rot }, (minX + maxX) / 2, (minZ + maxZ) / 2);
  return { cx, cz, hx: (maxX - minX) / 2, hz: (maxZ - minZ) / 2, rot: s.rot };
}

/** Footprint boxes (one per section) for collisions, holes and hit tests. */
export const stairFootprint = (s: Stair): Obb[] => stairSections(s).map((sec) => sec.obb);

/** Walking height on a flight, quantised slightly towards the steps for a natural feel. */
function flightHeight(sec: StairSection, t: number): number {
  const n = Math.max(1, sec.steps);
  const stepped = Math.min(n, Math.floor(t * n + 0.5)) / n;
  return sec.y0 + (sec.y1 - sec.y0) * (0.65 * t + 0.35 * stepped);
}

/** Height above the stair base at (x, z), or null if the point is not on the stair. */
export function stairHeightAt(s: Stair, rise: number, x: number, z: number, pad = 0): number | null {
  for (const sec of stairSections(s, rise)) {
    const [lx, lz] = toLocal(sec.obb, x, z);
    if (Math.abs(lx) > sec.obb.hx + pad || Math.abs(lz) > sec.obb.hz + pad) continue;
    if (sec.kind === 'landing') return sec.y0;
    return flightHeight(sec, clamp(lz / (2 * sec.obb.hz) + 0.5, 0, 1));
  }
  return null;
}
