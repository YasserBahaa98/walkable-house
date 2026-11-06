import { describe, expect, it } from 'vitest';
import { obbOverlap, pushCircle, segmentObb, toLocal, toWorld } from '../src/geometry/math';
import { endExtensions, openingSpans, solidObbs, splitWall, wallPieces } from '../src/geometry/walls';
import { roomRegions, regionAt } from '../src/geometry/rooms';
import { checkLevel } from '../src/geometry/checks';
import { stairHeight, stairProgress, stepCount } from '../src/geometry/stairs';
import { boxLevel, door, wall, windowOn } from './helpers';

describe('oriented boxes', () => {
  it('converts between local and world coordinates consistently', () => {
    const o = { cx: 1, cz: 2, hx: 1, hz: 0.5, rot: 0.7 };
    const [x, z] = toWorld(o, 0.3, -0.2);
    const [lx, lz] = toLocal(o, x, z);
    expect(lx).toBeCloseTo(0.3);
    expect(lz).toBeCloseTo(-0.2);
  });

  it('pushes a circle out of a box', () => {
    const o = segmentObb({ x: 0, z: 0 }, { x: 4, z: 0 }, 0.2);
    const p = pushCircle(o, 2, 0.2, 0.25);
    expect(p).not.toBeNull();
    expect(p![1]).toBeCloseTo(0.35);
    expect(pushCircle(o, 2, 1, 0.25)).toBeNull();
  });

  it('detects overlap with separating axes', () => {
    const a = { cx: 0, cz: 0, hx: 1, hz: 1, rot: 0 };
    expect(obbOverlap(a, { cx: 1.5, cz: 0, hx: 1, hz: 1, rot: 0 })).toBeCloseTo(0.5);
    expect(obbOverlap(a, { cx: 3, cz: 0, hx: 1, hz: 1, rot: 0 })).toBe(0);
    expect(obbOverlap(a, { cx: 2.3, cz: 0, hx: 1, hz: 1, rot: Math.PI / 4 })).toBeGreaterThan(0);
  });
});

describe('walls', () => {
  it('splits a wall into solid pieces around openings', () => {
    const w = wall(0, 0, 5, 0);
    const pieces = wallPieces(w, [door(w, 1.5), windowOn(w, 3.5)], 2.7);
    // left, door lintel, middle, window sill, window head, right
    expect(pieces).toHaveLength(6);
    expect(pieces.find((p) => p.from === 1.05 && p.bottom === 2.1)).toBeTruthy();
    expect(pieces.find((p) => p.from === 2.9 && p.top === 0.9)).toBeTruthy();
  });

  it('clamps openings to the wall and trims overlaps', () => {
    const w = wall(0, 0, 2, 0);
    const spans = openingSpans(w, [door(w, 0.1, 0.9), windowOn(w, 0.6, 1)]);
    expect(spans[0].from).toBeCloseTo(0);
    expect(spans[1].from).toBeCloseTo(spans[0].to);
  });

  it('leaves door gaps open for walking but keeps windows solid', () => {
    const level = boxLevel();
    level.openings.push(door(level.walls[0], 2), windowOn(level.walls[1], 1.5));
    const obbs = solidObbs(level);
    // bottom wall splits into two solids around the door; window wall stays one piece
    expect(obbs).toHaveLength(5);
  });

  it('extends corners by half the neighbour thickness', () => {
    const level = boxLevel();
    const ext = endExtensions(level.walls).get(level.walls[0].id)!;
    expect(ext[0]).toBeCloseTo(0.1);
    expect(ext[1]).toBeCloseTo(0.1);
  });

  it('splits a wall and moves openings to the right half', () => {
    const level = boxLevel();
    const d = door(level.walls[0], 3);
    level.openings.push(d);
    const ids = splitWall(level, level.walls[0].id, 2, () => 'new');
    expect(ids).toEqual([level.walls[0].id, 'new']);
    expect(d.wallId).toBe('new');
    expect(d.offset).toBeCloseTo(1);
  });
});

describe('rooms', () => {
  it('measures an enclosed room', () => {
    const level = boxLevel();
    const reg = roomRegions(level).get('r1')!;
    expect(reg.enclosed).toBe(true);
    // interior is 3.8 × 2.8 m (walls are 0.2 thick, centred on the lines)
    expect(reg.area).toBeGreaterThan(10.4);
    expect(reg.area).toBeLessThan(10.9);
    expect(reg.rects.length).toBeGreaterThan(0);
  });

  it('treats doors as walls for enclosure', () => {
    const level = boxLevel();
    level.openings.push(door(level.walls[0], 2));
    expect(roomRegions(level).get('r1')!.enclosed).toBe(true);
  });

  it('reports open rooms', () => {
    const level = boxLevel();
    level.walls.pop();
    expect(regionAt(level, { x: 2, z: 1.5 }).enclosed).toBe(false);
  });
});

describe('checks', () => {
  it('flags overlapping furniture, wall clashes and blocked doors', () => {
    const level = boxLevel();
    level.openings.push(door(level.walls[0], 2));
    level.items.push(
      { id: 'a', type: 'box', name: 'A', x: 1, z: 1.5, rot: 0, w: 1, d: 1, h: 1, color: '#ffffff' },
      { id: 'b', type: 'box', name: 'B', x: 1.5, z: 1.5, rot: 0, w: 1, d: 1, h: 1, color: '#ffffff' },
      { id: 'c', type: 'box', name: 'C', x: 3.9, z: 2.5, rot: 0, w: 0.6, d: 0.6, h: 1, color: '#ffffff' },
      { id: 'd', type: 'box', name: 'D', x: 2, z: 0.5, rot: 0, w: 0.6, d: 0.4, h: 1, color: '#ffffff' },
    );
    const msgs = checkLevel(level).map((i) => i.message);
    expect(msgs).toContain('A overlaps B');
    expect(msgs).toContain('C goes through a wall');
    expect(msgs).toContain('D blocks a door');
  });

  it('ignores rugs and stacked items at different heights', () => {
    const level = boxLevel();
    level.items.push(
      { id: 'r', type: 'rug', name: 'Rug', x: 2, z: 1.5, rot: 0, w: 2, d: 1.5, h: 0.01, color: '#ffffff' },
      { id: 't', type: 'table', name: 'Table', x: 2, z: 1.5, rot: 0, w: 1, d: 0.6, h: 0.4, color: '#ffffff' },
      { id: 'v', type: 'tv', name: 'TV', x: 2, z: 1.5, rot: 0, w: 1, d: 0.1, h: 0.6, color: '#000000', elevation: 1.3 },
    );
    expect(checkLevel(level)).toHaveLength(0);
  });
});

describe('stairs', () => {
  const s = { id: 's', x: 0, z: 0, rot: 0, width: 1, length: 3 };
  it('maps the footprint to climb progress', () => {
    expect(stairProgress(s, 0, -1.5)).toBeCloseTo(0);
    expect(stairProgress(s, 0, 1.5)).toBeCloseTo(1);
    expect(stairProgress(s, 2, 0)).toBeNull();
  });
  it('reaches the full rise at the top', () => {
    expect(stepCount(3)).toBe(17);
    expect(stairHeight(s, 3, 1)).toBeCloseTo(3);
    expect(stairHeight(s, 3, 0)).toBeCloseTo(0);
  });
});
