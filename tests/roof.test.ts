import { describe, expect, it } from 'vitest';
import { roofFaces, type V3 } from '../src/geometry/roof';
import type { Roof } from '../src/model/types';

const rect = { minX: 0, minZ: 0, maxX: 10, maxZ: 6 };
const roof = (patch: Partial<Roof>): Roof => ({ type: 'gable', pitch: 30, overhang: 0.5, ridge: 'auto', material: 'clay', ...patch });

/** Normal from the first triangle (b − a) × (c − a), y component. */
const ny = (f: V3[]) => {
  const [a, b, c] = f;
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return u[2] * v[0] - u[0] * v[2];
};

describe('roofFaces', () => {
  it('builds a gable roof along the longer side with two gable ends', () => {
    const f = roofFaces(rect, 3, roof({}));
    expect(f.slopes).toHaveLength(2);
    expect(f.gables).toHaveLength(2);
    // Ridge height: wall top + half the span × tan(30°)
    expect(f.ridgeHeight).toBeCloseTo(3 + 3 * Math.tan(Math.PI / 6));
    // Ridge runs along X (the longer side): ridge points share z = 3.
    const ridgePts = f.slopes[0].filter((p) => Math.abs(p[1] - f.ridgeHeight) < 1e-9);
    ridgePts.forEach((p) => expect(p[2]).toBeCloseTo(3));
    // Eaves extend past the walls by the overhang.
    expect(Math.min(...f.slopes.flat().map((p) => p[0]))).toBeCloseTo(-0.5);
  });

  it('builds a hip roof with four upward-facing slopes', () => {
    const f = roofFaces(rect, 3, roof({ type: 'hip' }));
    expect(f.slopes).toHaveLength(4);
    expect(f.gables).toHaveLength(0);
    f.slopes.forEach((s) => expect(ny(s)).toBeGreaterThan(0));
  });

  it('honours an explicit ridge direction and flat roofs', () => {
    const z = roofFaces(rect, 3, roof({ ridge: 'z' }));
    const ridgePts = z.slopes[0].filter((p) => Math.abs(p[1] - z.ridgeHeight) < 1e-9);
    ridgePts.forEach((p) => expect(p[0]).toBeCloseTo(5));
    const flat = roofFaces(rect, 3, roof({ type: 'flat' }));
    expect(flat.slopes).toHaveLength(1);
    expect(ny(flat.slopes[0])).toBeGreaterThan(0);
  });

  it('orients every gable slope upwards', () => {
    roofFaces(rect, 3, roof({})).slopes.forEach((s) => expect(ny(s)).toBeGreaterThan(0));
  });
});
