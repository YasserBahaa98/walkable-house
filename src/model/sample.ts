import { uid } from './ids';
import type { Item, Level, Opening, Project, Wall } from './types';
import { CATALOG } from './catalog';

const T = 0.2;   // exterior walls
const TI = 0.1;  // interior walls

function wall(x1: number, z1: number, x2: number, z2: number, thickness = T): Wall {
  return { id: uid('w'), a: { x: x1, z: z1 }, b: { x: x2, z: z2 }, thickness };
}

function door(w: Wall, offset: number, width = 0.9, hinge: 'start' | 'end' = 'start', swing: 'left' | 'right' = 'left'): Opening {
  return { id: uid('o'), wallId: w.id, kind: 'door', offset, width, height: 2.1, sill: 0, hinge, swing };
}

function win(w: Wall, offset: number, width = 1.4, sill = 0.9, height = 1.3): Opening {
  return { id: uid('o'), wallId: w.id, kind: 'window', offset, width, height, sill };
}

function item(name: string, x: number, z: number, rot = 0, patch: Partial<Item> = {}): Item {
  const c = CATALOG.find((e) => e.name === name)!;
  return {
    id: uid('i'), type: c.type, name: c.name, x, z, rot, w: c.w, d: c.d, h: c.h, color: c.color,
    ...(c.elevation ? { elevation: c.elevation } : {}), ...patch,
  };
}

/** A small two-storey demo house so the app is useful before any import. */
export function sampleProject(): Project {
  // Ground floor: 9 x 7 m. Open living/dining + hall, kitchen, WC.
  const g = [
    wall(0, 0, 9, 0), wall(9, 0, 9, 7), wall(9, 7, 0, 7), wall(0, 7, 0, 0),
    wall(5.6, 0, 5.6, 3.4, TI), wall(5.6, 3.4, 9, 3.4, TI), wall(7.8, 3.4, 7.8, 7, TI),
  ];
  const ground: Level = {
    id: uid('L'), name: 'Ground floor', elevation: 0, height: 2.7,
    walls: g,
    openings: [
      win(g[0], 1.6, 2.0), win(g[0], 4.0, 1.4), win(g[0], 7.4, 1.2, 1.1, 1.0),
      win(g[1], 1.2, 1.0, 1.0, 1.1), win(g[1], 5.2, 0.6, 1.5, 0.6),
      door(g[2], 4.5, 1.0, 'end', 'right'), win(g[2], 6.6, 1.6),
      win(g[3], 3.5, 1.8),
      door(g[4], 2.6, 0.9, 'start', 'right'), door(g[6], 1.0, 0.8, 'start', 'left'),
    ],
    rooms: [
      { id: uid('r'), name: 'Living & hall', seed: { x: 2.5, z: 3.5 }, floor: 'oak' },
      { id: uid('r'), name: 'Kitchen', seed: { x: 7.3, z: 1.7 }, floor: 'tile' },
      { id: uid('r'), name: 'WC', seed: { x: 8.4, z: 5.2 }, floor: 'marble' },
    ],
    items: [
      item('Sofa', 3.3, 1.7, Math.PI / 2),
      item('Rug', 4.25, 1.7, Math.PI / 2),
      item('Coffee table', 4.35, 1.7, Math.PI / 2),
      item('TV', 5.5, 1.7, -Math.PI / 2, { elevation: 0.5, h: 0.75 }),
      item('Bookshelf', 0.27, 1.2, Math.PI / 2),
      item('Dining table', 2.2, 5.2),
      item('Chair', 1.75, 4.55), item('Chair', 2.65, 4.55),
      item('Chair', 1.75, 5.85, Math.PI), item('Chair', 2.65, 5.85, Math.PI),
      item('Plant', 0.45, 6.5),
      item('Kitchen counter', 7.45, 0.41, 0, { w: 2.8 }),
      item('Fridge', 8.55, 2.9, -Math.PI / 2),
      item('Toilet', 8.4, 6.55, Math.PI),
      item('Vanity sink', 8.4, 3.7, 0, { w: 0.6 }),
    ],
    stairs: [{ id: uid('s'), x: 6.7, z: 5.45, rot: Math.PI, width: 1.0, length: 2.8 }],
  };

  // First floor: bedrooms, bathroom, study and landing over the same footprint.
  const f = [
    wall(0, 0, 9, 0), wall(9, 0, 9, 7), wall(9, 7, 0, 7), wall(0, 7, 0, 0),
    wall(4.2, 0, 4.2, 3.4, TI), wall(0, 3.4, 5.6, 3.4, TI), wall(5.6, 3.4, 5.6, 7, TI),
    wall(6.8, 0, 6.8, 3.4, TI), wall(5.6, 3.4, 9, 3.4, TI),
  ];
  const first: Level = {
    id: uid('L'), name: 'First floor', elevation: 3.0, height: 2.6,
    walls: f,
    openings: [
      win(f[0], 2.1, 1.6), win(f[0], 5.5, 1.2), win(f[0], 7.9, 0.9, 1.4, 0.8),
      win(f[1], 5.2, 1.4), win(f[2], 6.0, 1.6), win(f[3], 1.7, 1.2),
      door(f[5], 3.6, 0.9, 'start', 'left'), door(f[6], 1.2, 0.9, 'end', 'right'),
      door(f[8], 0.6, 0.8, 'start', 'left'), door(f[8], 2.4, 0.8, 'end', 'left'),
    ],
    rooms: [
      { id: uid('r'), name: 'Main bedroom', seed: { x: 2.0, z: 1.7 }, floor: 'carpet' },
      { id: uid('r'), name: 'Bedroom', seed: { x: 5.5, z: 1.7 }, floor: 'oak' },
      { id: uid('r'), name: 'Bathroom', seed: { x: 7.9, z: 1.7 }, floor: 'marble' },
      { id: uid('r'), name: 'Study', seed: { x: 2.5, z: 5.2 }, floor: 'walnut' },
      { id: uid('r'), name: 'Landing', seed: { x: 8.0, z: 5.2 }, floor: 'oak' },
    ],
    items: [
      item('Double bed', 2.0, 1.15),
      item('Wardrobe', 1.0, 3.05, Math.PI, { w: 1.4 }),
      item('Single bed', 5.0, 1.15),
      item('Desk', 6.42, 1.4, -Math.PI / 2, { w: 1.1 }),
      item('Bathtub', 7.875, 0.48, 0, { w: 1.9 }),
      item('Toilet', 8.56, 2.6, -Math.PI / 2),
      item('Vanity sink', 7.25, 3.11, Math.PI, { w: 0.6 }),
      item('Desk', 1.2, 6.575, Math.PI),
      item('Chair', 1.2, 6.0),
      item('Bookshelf', 4.0, 6.73, Math.PI),
      item('Armchair', 4.4, 4.3, Math.PI * 0.85),
      item('Floor lamp', 5.0, 3.8),
      item('Plant', 8.6, 6.6),
    ],
    stairs: [],
  };

  return {
    version: 1,
    name: 'Demo house',
    levels: [ground, first],
    layouts: [],
    activeLayoutId: null,
    underlays: {},
  };
}

export function emptyProject(name = 'Untitled house'): Project {
  return {
    version: 1,
    name,
    levels: [{ id: uid('L'), name: 'Ground floor', elevation: 0, height: 2.7, walls: [], openings: [], rooms: [], items: [], stairs: [] }],
    layouts: [],
    activeLayoutId: null,
    underlays: {},
  };
}
