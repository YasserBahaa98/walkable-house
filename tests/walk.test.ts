import { describe, expect, it } from 'vitest';
import type { Level } from '../src/model/types';
import { buildWalkWorld, step, type Walker } from '../src/view3d/walk';
import { boxLevel, door } from './helpers';

/** Walk in a straight line for `seconds` at 1.5 m/s. */
function walk(world: ReturnType<typeof buildWalkWorld>, w: Walker, dx: number, dz: number, seconds: number): Walker {
  let cur = w;
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) cur = step(world, cur, dx * 1.5 * dt, dz * 1.5 * dt, dt);
  return cur;
}

describe('walking', () => {
  it('cannot pass through walls', () => {
    const world = buildWalkWorld([boxLevel()]);
    const end = walk(world, { x: 2, z: 1.5, y: 0 }, 0, -1, 3);
    expect(end.z).toBeGreaterThan(0.1 + 0.2); // stopped by the wall face + body radius
  });

  it('passes through a door', () => {
    const level = boxLevel();
    level.openings.push(door(level.walls[0], 2, 1));
    const world = buildWalkWorld([level]);
    const end = walk(world, { x: 2, z: 1.5, y: 0 }, 0, -1, 3);
    expect(end.z).toBeLessThan(-1);
  });

  it('slides along walls instead of sticking', () => {
    const world = buildWalkWorld([boxLevel()]);
    const end = walk(world, { x: 1, z: 0.5, y: 0 }, 0.7, -0.7, 1);
    expect(end.x).toBeGreaterThan(1.8);
  });

  it('climbs stairs to the level above', () => {
    const ground: Level = { ...boxLevel(), id: 'g', stairs: [{ id: 's', x: 1, z: 1.5, rot: Math.PI / 2, width: 0.9, length: 2.4 }] };
    const upper: Level = { ...boxLevel(), id: 'u', elevation: 3, walls: [], rooms: [] };
    const world = buildWalkWorld([ground, upper]);
    // Stair climbs along +X from x=-0.2 to x=2.2; walk up it.
    let w: Walker = { x: -0.0, z: 1.5, y: 0 };
    w = walk(world, w, 1, 0, 2.2);
    expect(w.y).toBeGreaterThan(2.9);
  });
});
