import type { Level, Vec2, Wall } from '../model/types';
import { endExtensions, wallObb } from './walls';
import { type Obb, toLocal } from './math';

export interface Rect { x: number; z: number; w: number; d: number }

export interface Region {
  /** False if the flood fill escaped the drawing (room not closed by walls). */
  enclosed: boolean;
  /** Floor area in m² (0 if not enclosed). */
  area: number;
  /** Floor as merged rectangles, slightly extended under the surrounding walls. */
  rects: Rect[];
  centroid: Vec2;
}

interface Grid {
  x0: number; z0: number; cell: number; nx: number; nz: number;
  blocked: Uint8Array;
}

const MARGIN = 0.6;

function buildGrid(walls: Wall[]): Grid | null {
  if (!walls.length) return null;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const w of walls) {
    for (const p of [w.a, w.b]) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
  }
  minX -= MARGIN; minZ -= MARGIN; maxX += MARGIN; maxZ += MARGIN;
  const span = Math.max(maxX - minX, maxZ - minZ);
  // 5 cm cells for normal houses, coarser for very large drawings (bounded memory).
  const cell = Math.max(0.05, span / 1400);
  const nx = Math.ceil((maxX - minX) / cell), nz = Math.ceil((maxZ - minZ) / cell);
  const blocked = new Uint8Array(nx * nz);
  const ext = endExtensions(walls);
  for (const w of walls) {
    // Openings are deliberately ignored: a room is bounded by walls, doors included.
    rasterize(blocked, nx, nz, minX, minZ, cell, wallObb(w, ext.get(w.id)), Math.max(w.thickness, cell * 1.5) / 2);
  }
  return { x0: minX, z0: minZ, cell, nx, nz, blocked };
}

function rasterize(blocked: Uint8Array, nx: number, nz: number, x0: number, z0: number, cell: number, o: Obb, minHalf: number) {
  const box: Obb = { ...o, hz: Math.max(o.hz, minHalf) };
  const r = Math.hypot(box.hx, box.hz);
  const i0 = Math.max(0, Math.floor((box.cx - r - x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((box.cx + r - x0) / cell));
  const j0 = Math.max(0, Math.floor((box.cz - r - z0) / cell)), j1 = Math.min(nz - 1, Math.ceil((box.cz + r - z0) / cell));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const [lx, lz] = toLocal(box, x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell);
      if (Math.abs(lx) <= box.hx && Math.abs(lz) <= box.hz) blocked[j * nx + i] = 1;
    }
  }
}

function flood(g: Grid, seed: Vec2): Region {
  const empty: Region = { enclosed: false, area: 0, rects: [], centroid: { ...seed } };
  const si = Math.floor((seed.x - g.x0) / g.cell), sj = Math.floor((seed.z - g.z0) / g.cell);
  if (si < 0 || sj < 0 || si >= g.nx || sj >= g.nz) return empty;
  const start = sj * g.nx + si;
  if (g.blocked[start]) return empty;
  const mark = new Uint8Array(g.nx * g.nz);
  const queue = new Int32Array(g.nx * g.nz);
  let head = 0, tail = 0, count = 0, sx = 0, sz = 0;
  queue[tail++] = start;
  mark[start] = 1;
  let escaped = false;
  while (head < tail) {
    const c = queue[head++];
    const i = c % g.nx, j = (c - i) / g.nx;
    count++; sx += i; sz += j;
    if (i === 0 || j === 0 || i === g.nx - 1 || j === g.nz - 1) { escaped = true; break; }
    for (const n of [c - 1, c + 1, c - g.nx, c + g.nx]) {
      if (!mark[n] && !g.blocked[n]) { mark[n] = 1; queue[tail++] = n; }
    }
  }
  if (escaped) return empty;
  const area = count * g.cell * g.cell;
  // Grow one cell into the walls so floors tuck underneath them without gaps.
  const grown = mark.slice();
  for (let j = 1; j < g.nz - 1; j++) {
    for (let i = 1; i < g.nx - 1; i++) {
      const c = j * g.nx + i;
      if (!mark[c] && (mark[c - 1] || mark[c + 1] || mark[c - g.nx] || mark[c + g.nx])) grown[c] = 1;
    }
  }
  return {
    enclosed: true, area,
    rects: greedyRects(grown, g),
    centroid: { x: g.x0 + (sx / count + 0.5) * g.cell, z: g.z0 + (sz / count + 0.5) * g.cell },
  };
}

/** Merge filled cells into as few rectangles as practical (row runs merged downwards). */
function greedyRects(mask: Uint8Array, g: Grid): Rect[] {
  const rects: Rect[] = [];
  let open = new Map<string, Rect>();
  for (let j = 0; j < g.nz; j++) {
    const next = new Map<string, Rect>();
    let i = 0;
    while (i < g.nx) {
      if (!mask[j * g.nx + i]) { i++; continue; }
      const s = i;
      while (i < g.nx && mask[j * g.nx + i]) i++;
      const key = `${s}:${i}`;
      const prev = open.get(key);
      if (prev) { prev.d += g.cell; next.set(key, prev); open.delete(key); } else {
        const r = { x: g.x0 + s * g.cell, z: g.z0 + j * g.cell, w: (i - s) * g.cell, d: g.cell };
        rects.push(r);
        next.set(key, r);
      }
    }
    open = next;
  }
  return rects;
}

const cache = new Map<string, Map<string, Region>>();

/** Regions for every room on the level, memoised on the geometry that affects them. */
export function roomRegions(level: Level): Map<string, Region> {
  const key = JSON.stringify([level.walls.map((w) => [w.a, w.b, w.thickness]), level.rooms.map((r) => [r.id, r.seed])]);
  const hit = cache.get(key);
  if (hit) return hit;
  const g = buildGrid(level.walls);
  const out = new Map<string, Region>();
  for (const r of level.rooms) out.set(r.id, g ? flood(g, r.seed) : { enclosed: false, area: 0, rects: [], centroid: r.seed });
  cache.set(key, out);
  if (cache.size > 24) cache.delete(cache.keys().next().value!);
  return out;
}

/** Region containing an arbitrary point (used by the room tool before creating a room). */
export function regionAt(level: Level, p: Vec2): Region {
  const g = buildGrid(level.walls);
  return g ? flood(g, p) : { enclosed: false, area: 0, rects: [], centroid: p };
}

export function pointInRegion(region: Region, x: number, z: number): boolean {
  return region.rects.some((r) => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d);
}

/** A stretch of one side of a wall that faces a room: `side` 1 is wallDir's normal, -1 the other face. */
export interface WallSpan { wall: Wall; side: 1 | -1; from: number; to: number }

/** The parts of each wall face that border a room (for painting the room). */
export function roomWallSpans(level: Level, region: Region, step = 0.05): WallSpan[] {
  const out: WallSpan[] = [];
  for (const w of level.walls) {
    const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
    if (len < 1e-6) continue;
    const ux = (w.b.x - w.a.x) / len, uz = (w.b.z - w.a.z) / len;
    const nx = uz, nz = -ux;
    const off = w.thickness / 2 + 0.12;
    for (const side of [1, -1] as const) {
      let start: number | null = null;
      const n = Math.ceil(len / step);
      for (let i = 0; i <= n; i++) {
        const t = Math.min(len, i * step);
        const inside = pointInRegion(region, w.a.x + ux * t + nx * side * off, w.a.z + uz * t + nz * side * off);
        if (inside && start === null) start = t;
        if ((!inside || i === n) && start !== null) {
          const end = inside ? len : t;
          // Run on a little so the paint meets the walls at the corners.
          out.push({ wall: w, side, from: start - step * 2, to: end + step });
          start = null;
        }
      }
    }
  }
  return out;
}
