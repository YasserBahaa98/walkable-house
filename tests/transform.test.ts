import { describe, expect, it } from 'vitest';
import { scaleLevel } from '../src/geometry/transform';
import { sampleProject } from '../src/model/sample';

describe('scaleLevel (calibration)', () => {
  it('scales walls, openings, stairs and the reference drawing around a point, but not furniture size', () => {
    const p = sampleProject();
    const l = p.levels[0];
    p.underlays[l.id] = { kind: 'cad', segments: [0, 0, 9, 0] };
    const wall = l.walls[0];
    const door = l.openings[0];
    const item = l.items[0];
    const [w0, d0, x0] = [item.w, item.d, item.x];
    const offset0 = door.offset;
    const b0 = { ...wall.b };
    const len0 = l.stairs[0].length;
    scaleLevel(p, l, { x: 0, z: 0 }, 2);
    expect(wall.b).toEqual({ x: b0.x * 2, z: b0.z * 2 });
    expect(door.offset).toBeCloseTo(offset0 * 2);
    expect(item.x).toBeCloseTo(x0 * 2);
    expect([item.w, item.d]).toEqual([w0, d0]);
    expect(l.stairs[0].length).toBeCloseTo(len0 * 2);
    const ul = p.underlays[l.id];
    expect(ul.kind === 'cad' && ul.segments).toEqual([0, 0, 18, 0]);
  });

  it('keeps the calibration origin fixed', () => {
    const p = sampleProject();
    const l = p.levels[0];
    p.underlays[l.id] = { kind: 'image', dataUrl: 'data:image/png;base64,', x: 1, z: 1, scale: 0.01, width: 100, height: 100 };
    scaleLevel(p, l, { x: 1, z: 1 }, 3);
    const ul = p.underlays[l.id];
    expect(ul.kind === 'image' && [ul.x, ul.z, ul.scale]).toEqual([1, 1, 0.03]);
  });
});
