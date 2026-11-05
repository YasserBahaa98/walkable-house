import type { Level } from '../model/types';
import { itemObb } from '../geometry/checks';
import { type Obb, pushCircle } from '../geometry/math';
import { stairHeight, stairProgress, stairRise } from '../geometry/stairs';
import { solidObbs } from '../geometry/walls';

export const PLAYER_RADIUS = 0.22;

interface WalkLevel { level: Level; elevation: number; obbs: Obb[]; stairs: { s: Level['stairs'][number]; rise: number }[] }
export interface WalkWorld { levels: WalkLevel[] }

/** Collision world for walking, built from the project (levels sorted by elevation). */
export function buildWalkWorld(levels: Level[]): WalkWorld {
  const sorted = [...levels].sort((a, b) => a.elevation - b.elevation);
  return {
    levels: sorted.map((level, i) => ({
      level,
      elevation: level.elevation,
      obbs: [
        ...solidObbs(level),
        ...level.items
          .filter((it) => it.type !== 'rug' && (it.elevation ?? 0) < 0.5 && it.h > 0.25)
          .map(itemObb),
      ],
      stairs: level.stairs.map((s) => ({ s, rise: stairRise(level, sorted[i + 1]) })),
    })),
  };
}

export interface Walker { x: number; z: number; y: number }

/** The level whose floor the walker is standing on (by height). */
export function currentLevel(world: WalkWorld, y: number): WalkLevel | undefined {
  let best: WalkLevel | undefined;
  for (const l of world.levels) if (l.elevation <= y + 0.35) best = l;
  return best ?? world.levels[0];
}

/** Floor height under (x, z) for a walker currently at height y. */
export function groundHeight(world: WalkWorld, x: number, z: number, y: number): number {
  const lvl = currentLevel(world, y);
  let ground = lvl?.elevation ?? 0;
  let bestDiff = Infinity;
  for (const l of world.levels) {
    for (const { s, rise } of l.stairs) {
      if (y < l.elevation - 0.6 || y > l.elevation + rise + 0.6) continue;
      const t = stairProgress(s, x, z);
      if (t === null) continue;
      const h = l.elevation + stairHeight(s, rise, t);
      const diff = Math.abs(h - y);
      if (diff < bestDiff && diff < 0.7) { bestDiff = diff; ground = h; }
    }
  }
  return ground;
}

/**
 * Move the walker by (dx, dz) with collisions, then settle its height on the
 * floor or stairs. Returns the new state (input is not mutated).
 */
export function step(world: WalkWorld, w: Walker, dx: number, dz: number, dt: number): Walker {
  let x = w.x, z = w.z;
  // Sub-step large moves so fast walkers do not tunnel through thin walls.
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(dist / 0.08));
  for (let k = 0; k < steps; k++) {
    x += dx / steps;
    z += dz / steps;
    const lvl = currentLevel(world, w.y);
    if (!lvl) continue;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const o of lvl.obbs) {
        const p = pushCircle(o, x, z, PLAYER_RADIUS);
        if (p) { x = p[0]; z = p[1]; moved = true; }
      }
      if (!moved) break;
    }
  }
  const target = groundHeight(world, x, z, w.y);
  const k = Math.min(1, dt * 14);
  const y = Math.abs(target - w.y) < 0.002 ? target : w.y + (target - w.y) * k;
  return { x, z, y };
}
