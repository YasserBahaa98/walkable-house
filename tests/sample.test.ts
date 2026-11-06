import { describe, expect, it } from 'vitest';
import { sampleProject } from '../src/model/sample';
import { checkLevel } from '../src/geometry/checks';
import { roomRegions } from '../src/geometry/rooms';
import { buildWalkWorld, step, type Walker } from '../src/view3d/walk';

describe('demo house', () => {
  const p = sampleProject();

  it('has no design problems and every room is closed', () => {
    for (const level of p.levels) {
      expect(checkLevel(level).filter((i) => i.severity === 'warning').map((i) => i.message)).toEqual([]);
      const regions = roomRegions(level);
      for (const r of level.rooms) expect(regions.get(r.id)?.enclosed, `${level.name}: ${r.name}`).toBe(true);
    }
  });

  it('can be walked from the front door up the stairs onto the landing and into a bedroom', () => {
    const world = buildWalkWorld(p.levels);
    const dt = 1 / 60;
    const walk = (w: Walker, dx: number, dz: number, seconds: number) => {
      for (let t = 0; t < seconds; t += dt) w = step(world, w, dx * 1.5 * dt, dz * 1.5 * dt, dt);
      return w;
    };
    let w: Walker = { x: 5.0, z: 7.5, y: 0 };   // just inside the front door
    w = walk(w, -1, 0, 1.4);                   // west, to the foot of the stair
    w = walk(w, 0, -1, 1.2);                   // north, in line with the flight
    expect(w.z).toBeLessThan(5.7);
    w = walk(w, 1, 0, 3.0);                    // up the stair (it climbs east)
    expect(w.y).toBeGreaterThan(2.9);
    w = walk(w, 0, -1, 1.5);                   // north through the bedroom door
    expect(w.z).toBeLessThan(4.4);
    expect(w.y).toBeGreaterThan(2.9);
  });
});
