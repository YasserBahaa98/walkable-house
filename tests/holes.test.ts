import { describe, expect, it } from 'vitest';
import { cutHoles } from '../src/geometry/holes';
import type { Rect } from '../src/geometry/rooms';

const area = (rs: Rect[]) => rs.reduce((a, r) => a + r.w * r.d, 0);
const covers = (rs: Rect[], x: number, z: number) => rs.some((r) => x > r.x && x < r.x + r.w && z > r.z && z < r.z + r.d);

describe('cutHoles', () => {
  it('leaves rectangles without holes untouched', () => {
    const rects = [{ x: 0, z: 0, w: 4, d: 3 }];
    expect(cutHoles(rects, [])).toBe(rects);
    expect(cutHoles(rects, [{ cx: 10, cz: 10, hx: 0.5, hz: 1, rot: 0 }])).toEqual(rects);
  });

  it('removes a stairwell from a floor', () => {
    const floor = [{ x: 0, z: 0, w: 5, d: 4 }, { x: 5, z: 0, w: 2, d: 4 }];
    const hole = { cx: 2, cz: 2, hx: 0.5, hz: 1.4, rot: 0 };
    const out = cutHoles(floor, [hole]);
    expect(area(out)).toBeCloseTo(28 - 1 * 2.8, 1);
    expect(covers(out, 2, 2)).toBe(false);
    expect(covers(out, 0.5, 0.5)).toBe(true);
    expect(covers(out, 6, 2)).toBe(true);
  });

  it('handles rotated holes', () => {
    const out = cutHoles([{ x: -3, z: -3, w: 6, d: 6 }], [{ cx: 0, cz: 0, hx: 0.5, hz: 1.5, rot: Math.PI / 2 }]);
    expect(covers(out, 1, 0)).toBe(false);
    expect(covers(out, 0, 1)).toBe(true);
    expect(area(out)).toBeCloseTo(36 - 3, 0);
  });
});
