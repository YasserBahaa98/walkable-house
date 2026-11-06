import { describe, expect, it } from 'vitest';
import { furnishRoom, itemsInRoom, roomKind } from '../src/geometry/furnish';
import { checkLevel } from '../src/geometry/checks';
import { sampleProject } from '../src/model/sample';
import type { Level } from '../src/model/types';
import { door, wall, windowOn } from './helpers';

const warnings = (l: Level) => checkLevel(l).filter((i) => i.severity === 'warning').map((i) => i.message);

/** A w × d room with a door in the bottom wall and a window in the top wall. */
function room(name: string, w: number, d: number): Level {
  const walls = [wall(0, 0, w, 0), wall(w, 0, w, d), wall(w, d, 0, d), wall(0, d, 0, 0)];
  return {
    id: 'L', name: 'L', elevation: 0, height: 2.7, walls,
    openings: [door(walls[0], Math.min(1, w / 2), 0.9), windowOn(walls[2], w / 2, Math.min(1.4, w - 0.6))],
    rooms: [{ id: 'r', name, seed: { x: w / 2, z: d / 2 }, floor: 'oak' }], items: [], stairs: [],
  };
}

function furnish(level: Level, variant = 0) {
  const items = furnishRoom(level, level.rooms[0], variant)!;
  level.items.push(...items);
  return items;
}

describe('roomKind', () => {
  it('reads common names in several languages', () => {
    expect(roomKind('Main bedroom', 14)).toBe('bedroom');
    expect(roomKind('Dormitorio 2', 10)).toBe('bedroom');
    expect(roomKind('Sala de estar', 20)).toBe('living');
    expect(roomKind('Kitchen & dining', 20)).toBe('kitchen');
    expect(roomKind('Baño', 5)).toBe('bath');
    expect(roomKind('WC', 2)).toBe('wc');
    expect(roomKind('Landing', 8)).toBe('hall');
    expect(roomKind('Room 3', 12)).toBe('bedroom');
  });
});

describe('furnishRoom', () => {
  const cases: [string, number, number, string[]][] = [
    ['Bedroom', 4, 3.6, ['bed', 'nightstand', 'wardrobe']],
    ['Small bedroom', 3, 2.8, ['bed']],
    ['Living room', 5.5, 4.5, ['sofa', 'table', 'tv', 'rug', 'armchair']],
    ['Kitchen', 4.5, 3.5, ['counter', 'fridge', 'table', 'chair']],
    ['Dining', 4, 3.5, ['table', 'chair']],
    ['Bathroom', 2.6, 2.4, ['bathtub', 'toilet', 'sink']],
    ['WC', 1.4, 1.6, ['toilet']],
    ['Study', 3, 3, ['desk', 'chair', 'bookshelf']],
    ['Hall', 2, 4, ['plant']],
  ];
  for (const [name, w, d, expected] of cases) {
    it(`furnishes a ${w} × ${d} m ${name} without clashes`, () => {
      const level = room(name, w, d);
      const items = furnish(level);
      const types = new Set(items.map((i) => i.type));
      for (const t of expected) expect(types, `${name} should get a ${t}`).toContain(t);
      expect(warnings(level)).toEqual([]);
    });
  }

  it('gives different valid layouts for other variants', () => {
    const layouts = new Set<string>();
    for (let v = 0; v < 4; v++) {
      const level = room('Living room', 5.5, 4.5);
      const items = furnish(level, v);
      expect(warnings(level)).toEqual([]);
      layouts.add(JSON.stringify(items.map((i) => [i.type, i.x, i.z])));
    }
    expect(layouts.size).toBeGreaterThan(1);
  });

  it('refurnishes every room of the demo house cleanly', () => {
    for (const level of sampleProject().levels) {
      for (const r of level.rooms) {
        const old = new Set(itemsInRoom(level, r.id).map((i) => i.id));
        const items = furnishRoom(level, r)!;
        expect(items.length, `${level.name}: ${r.name}`).toBeGreaterThan(0);
        level.items = [...level.items.filter((i) => !old.has(i.id)), ...items];
      }
      expect(warnings(level), level.name).toEqual([]);
    }
  });

  it('returns null for a room that is not closed', () => {
    const level = room('Bedroom', 4, 3);
    level.walls.pop();
    expect(furnishRoom(level, level.rooms[0])).toBeNull();
  });
});
