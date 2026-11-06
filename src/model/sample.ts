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

/**
 * A two-storey demo house (10 x 8 m) so the app is useful before any import.
 *
 * Ground floor: living room and kitchen-diner at the front, joined by a wide
 * opening; entrance hall, study and WC at the back. The stair rises along the
 * hall's inner wall with clear space at its foot and lands on an open landing.
 * First floor: two bedrooms at the front, landing with a reading nook and a
 * bathroom at the back.
 */
export function sampleProject(): Project {
  // ---------------------------------------------------------------- ground
  const g = {
    front: wall(0, 0, 10, 0), east: wall(10, 0, 10, 8), back: wall(0, 8, 10, 8), west: wall(0, 8, 0, 0),
    spine: wall(0, 4.6, 10, 4.6, TI),            // front rooms | back rooms
    kitchen: wall(5.5, 0, 5.5, 4.6, TI),         // living | kitchen-diner
    study: wall(2.4, 4.6, 2.4, 8, TI),           // study | hall
    wc: wall(7.6, 4.6, 7.6, 8, TI),              // hall | WC
  };
  const ground: Level = {
    id: uid('L'), name: 'Ground floor', elevation: 0, height: 2.7,
    walls: Object.values(g),
    openings: [
      win(g.front, 2.75, 2.2), win(g.front, 7.85, 1.2, 1.1, 1.0),
      win(g.east, 3.0, 1.4), win(g.east, 6.8, 0.6, 1.5, 0.6),
      door(g.back, 5.0, 1.0, 'start', 'right'), win(g.back, 1.2, 1.0), win(g.back, 8.8, 0.6, 1.5, 0.6),
      win(g.west, 1.7, 1.2), win(g.west, 5.7, 1.4),
      door(g.spine, 2.9, 0.9, 'start', 'left'), door(g.spine, 7.1, 0.9, 'end', 'right'),
      { id: uid('o'), wallId: g.kitchen.id, kind: 'opening', offset: 2.3, width: 1.6, height: 2.2, sill: 0 },
      door(g.study, 2.6, 0.8, 'end', 'left'), door(g.wc, 2.5, 0.8, 'start', 'right'),
    ],
    rooms: [
      { id: uid('r'), name: 'Living', seed: { x: 2.5, z: 2.0 }, floor: 'oak' },
      { id: uid('r'), name: 'Kitchen & dining', seed: { x: 7.8, z: 1.6 }, floor: 'tile' },
      { id: uid('r'), name: 'Hall', seed: { x: 3.0, z: 7.0 }, floor: 'tile' },
      { id: uid('r'), name: 'Study', seed: { x: 1.2, z: 6.3 }, floor: 'walnut' },
      { id: uid('r'), name: 'WC', seed: { x: 8.8, z: 6.3 }, floor: 'marble' },
    ],
    items: [
      // Living: sofa faces the TV on the west wall, armchair turned towards both.
      item('TV', 0.16, 2.3, Math.PI / 2, { elevation: 0.5, h: 0.75 }),
      item('Rug', 2.35, 2.3, Math.PI / 2),
      item('Coffee table', 2.3, 2.3, Math.PI / 2),
      item('Sofa', 3.65, 2.3, -Math.PI / 2),
      item('Armchair', 2.3, 0.75, 0),
      item('Floor lamp', 4.6, 3.6),
      item('Bookshelf', 1.0, 4.39, Math.PI),
      item('Plant', 0.45, 0.45),
      // Kitchen-diner: counter and fridge along the front wall, table by the side window.
      item('Kitchen counter', 7.85, 0.41, 0, { w: 2.6 }),
      item('Fridge', 9.5, 0.45, 0),
      item('Dining table', 8.2, 3.0),
      item('Chair', 7.75, 2.22), item('Chair', 8.65, 2.22),
      item('Chair', 7.75, 3.78, Math.PI), item('Chair', 8.65, 3.78, Math.PI),
      item('Plant', 6.0, 4.15),
      // Hall
      item('Plant', 6.3, 7.5),
      // Study: desk under the window, chair facing it.
      item('Desk', 0.43, 6.1, Math.PI / 2, { w: 1.2 }),
      item('Chair', 1.05, 6.1, -Math.PI / 2),
      item('Bookshelf', 1.3, 4.81, 0),
      // WC
      item('Toilet', 9.56, 5.6, -Math.PI / 2),
      item('Vanity sink', 8.8, 4.89, 0, { w: 0.6 }),
    ],
    // Climbs east along the spine wall: the foot is by the hall door, the top
    // arrives on the landing in front of the second bedroom and the bathroom.
    stairs: [{ id: uid('s'), x: 5.0, z: 5.2, rot: Math.PI / 2, width: 1.0, length: 3.2 }],
  };

  // ------------------------------------------------------------ first floor
  const f = {
    front: wall(0, 0, 10, 0), east: wall(10, 0, 10, 8), back: wall(0, 8, 10, 8), west: wall(0, 8, 0, 0),
    spine: wall(0, 4.6, 10, 4.6, TI),
    bedrooms: wall(5, 0, 5, 4.6, TI),
    bath: wall(7.6, 4.6, 7.6, 8, TI),
  };
  const first: Level = {
    id: uid('L'), name: 'First floor', elevation: 3.0, height: 2.6,
    walls: Object.values(f),
    openings: [
      win(f.front, 2.5, 1.8), win(f.front, 6.2, 1.2), win(f.front, 8.8, 1.2),
      win(f.east, 2.6, 1.2), win(f.east, 6.4, 0.6, 1.5, 0.6),
      win(f.back, 1.4, 1.2), win(f.back, 5.0, 1.4),
      win(f.west, 1.6, 1.0), win(f.west, 6.0, 1.0),
      door(f.spine, 1.6, 0.9, 'start', 'left'), door(f.spine, 7.1, 0.9, 'end', 'right'),
      door(f.bath, 2.0, 0.8, 'start', 'right'),
    ],
    rooms: [
      { id: uid('r'), name: 'Main bedroom', seed: { x: 2.5, z: 2.3 }, floor: 'carpet' },
      { id: uid('r'), name: 'Bedroom', seed: { x: 7.5, z: 2.3 }, floor: 'oak' },
      { id: uid('r'), name: 'Landing', seed: { x: 2.0, z: 6.5 }, floor: 'oak' },
      { id: uid('r'), name: 'Bathroom', seed: { x: 8.8, z: 6.3 }, floor: 'marble' },
    ],
    items: [
      // Main bedroom: bed against the west wall, armchair by the window looking into the room.
      item('Double bed', 1.15, 2.2, Math.PI / 2),
      item('Rug', 2.6, 2.2, Math.PI / 2),
      item('Wardrobe', 3.85, 4.25, Math.PI),
      item('Armchair', 4.25, 0.85, -Math.PI / 4),
      item('Floor lamp', 3.4, 0.35),
      // Second bedroom
      item('Single bed', 8.87, 2.0, -Math.PI / 2),
      item('Desk', 6.2, 0.43, 0, { w: 1.2 }),
      item('Chair', 6.2, 1.05, Math.PI),
      item('Wardrobe', 5.35, 3.3, Math.PI / 2),
      item('Rug', 7.5, 2.7, 0, { w: 1.6, d: 1.0 }),
      // Landing: reading nook at the west end, away from the stairwell.
      item('Armchair', 0.8, 7.25, Math.PI * 0.75),
      item('Floor lamp', 0.35, 6.35),
      item('Bookshelf', 0.26, 5.6, Math.PI / 2),
      item('Plant', 7.15, 7.5),
      // Bathroom
      item('Bathtub', 8.8, 7.52, Math.PI),
      item('Toilet', 9.56, 5.5, -Math.PI / 2),
      item('Vanity sink', 8.4, 4.89, 0, { w: 0.6 }),
    ],
    stairs: [],
    roof: { type: 'hip', pitch: 28, overhang: 0.45, ridge: 'auto', material: 'slate' },
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
