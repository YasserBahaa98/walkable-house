import type { Rect } from './rooms';
import { type Obb, obbCorners, pointInObb } from './math';

/** Axis-aligned bounds of a (possibly rotated) box. */
function obbBounds(o: Obb) {
  const c = obbCorners(o);
  return {
    minX: Math.min(...c.map((p) => p.x)), maxX: Math.max(...c.map((p) => p.x)),
    minZ: Math.min(...c.map((p) => p.z)), maxZ: Math.max(...c.map((p) => p.z)),
  };
}

/**
 * Remove the area covered by `holes` (stairwells) from a set of rectangles.
 * Rectangles a hole does not touch are kept as they are; the others are
 * rasterised on a fine grid and re-merged into row strips.
 */
export function cutHoles(rects: Rect[], holes: Obb[], maxCells = 800): Rect[] {
  if (!holes.length) return rects;
  const hb = holes.map(obbBounds);
  const out: Rect[] = [];
  for (const r of rects) {
    const hit = holes.filter((_, i) => hb[i].maxX > r.x && hb[i].minX < r.x + r.w && hb[i].maxZ > r.z && hb[i].minZ < r.z + r.d);
    if (!hit.length) { out.push(r); continue; }
    out.push(...rasterCut(r, hit, maxCells));
  }
  return out;
}

function rasterCut(b: Rect, holes: Obb[], maxCells: number): Rect[] {
  const cell = Math.max(0.025, Math.max(b.w, b.d) / maxCells);
  const nx = Math.max(1, Math.ceil(b.w / cell)), nz = Math.max(1, Math.ceil(b.d / cell));
  const x1 = b.x + b.w, z1 = b.z + b.d;
  const rects: Rect[] = [];
  let open = new Map<string, Rect>();
  for (let j = 0; j < nz; j++) {
    const next = new Map<string, Rect>();
    const z = b.z + j * cell;
    const zc = Math.min(z + cell / 2, z1);
    const filled = (i: number) => {
      const x = Math.min(b.x + (i + 0.5) * cell, x1);
      return !holes.some((h) => pointInObb(h, x, zc));
    };
    let i = 0;
    while (i < nx) {
      if (!filled(i)) { i++; continue; }
      const s = i;
      while (i < nx && filled(i)) i++;
      const key = `${s}:${i}`;
      const dz = Math.min(cell, z1 - z);
      const prev = open.get(key);
      if (prev) { prev.d += dz; next.set(key, prev); open.delete(key); } else {
        const x0 = b.x + s * cell;
        const r = { x: x0, z, w: Math.min(x1, b.x + i * cell) - x0, d: dz };
        rects.push(r);
        next.set(key, r);
      }
    }
    open = next;
  }
  return rects;
}
