import type { Level, Stair } from '../model/types';
import { clamp, type Obb, toLocal } from './math';

export const stairObb = (s: Stair): Obb => ({ cx: s.x, cz: s.z, hx: s.width / 2, hz: s.length / 2, rot: s.rot });

/** Vertical rise of a stair: up to the next level, or a sensible default for the top level. */
export function stairRise(level: Level, above: Level | undefined): number {
  return above ? Math.max(0.3, above.elevation - level.elevation) : level.height + 0.2;
}

export function stepCount(rise: number): number {
  return Math.max(2, Math.round(rise / 0.18));
}

/**
 * Progress (0 at the bottom, 1 at the top) of a point on the stair footprint,
 * or null if the point is not on the stair.
 */
export function stairProgress(s: Stair, x: number, z: number, pad = 0): number | null {
  const [lx, lz] = toLocal(stairObb(s), x, z);
  if (Math.abs(lx) > s.width / 2 + pad || Math.abs(lz) > s.length / 2 + pad) return null;
  return clamp(lz / s.length + 0.5, 0, 1);
}

/** Walking height on a stair, quantised slightly towards the steps for a natural feel. */
export function stairHeight(_s: Stair, rise: number, t: number): number {
  const n = stepCount(rise);
  const stepped = Math.min(n, Math.floor(t * n + 0.5)) / n;
  return rise * (0.65 * t + 0.35 * stepped);
}
