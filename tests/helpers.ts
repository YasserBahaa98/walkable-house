import type { Level, Opening, Wall } from '../src/model/types';

let n = 0;
export const wall = (x1: number, z1: number, x2: number, z2: number, thickness = 0.2): Wall =>
  ({ id: `w${n++}`, a: { x: x1, z: z1 }, b: { x: x2, z: z2 }, thickness });

export const door = (w: Wall, offset: number, width = 0.9): Opening =>
  ({ id: `o${n++}`, wallId: w.id, kind: 'door', offset, width, height: 2.1, sill: 0, hinge: 'start', swing: 'left' });

export const windowOn = (w: Wall, offset: number, width = 1.2): Opening =>
  ({ id: `o${n++}`, wallId: w.id, kind: 'window', offset, width, height: 1.3, sill: 0.9 });

/** A 4 × 3 m box room with optional openings. */
export function boxLevel(extra: Partial<Level> = {}): Level {
  const walls = [wall(0, 0, 4, 0), wall(4, 0, 4, 3), wall(4, 3, 0, 3), wall(0, 3, 0, 0)];
  return {
    id: 'L0', name: 'Ground', elevation: 0, height: 2.7, walls, openings: [],
    rooms: [{ id: 'r1', name: 'Room', seed: { x: 2, z: 1.5 }, floor: 'oak' }], items: [], stairs: [],
    ...extra,
  };
}
