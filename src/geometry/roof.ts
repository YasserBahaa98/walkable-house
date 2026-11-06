import type { Level, Roof } from '../model/types';

export type V3 = [number, number, number];

export interface RoofFaces {
  /** Sloped (or flat) roof surfaces as polygons (3 or 4 points, counter-clockwise from above). */
  slopes: V3[][];
  /** Gable end walls (triangles in the wall plane). */
  gables: V3[][];
  ridgeHeight: number;
}

export interface RoofRect { minX: number; minZ: number; maxX: number; maxZ: number }

/** Outer footprint of a level's walls. */
export function wallRect(level: Level): RoofRect | null {
  if (!level.walls.length) return null;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const w of level.walls) {
    const p = w.thickness / 2;
    for (const q of [w.a, w.b]) {
      minX = Math.min(minX, q.x - p); maxX = Math.max(maxX, q.x + p);
      minZ = Math.min(minZ, q.z - p); maxZ = Math.max(maxZ, q.z + p);
    }
  }
  return { minX, minZ, maxX, maxZ };
}

/**
 * Roof surfaces over a rectangle whose walls top out at height `h`.
 * Coordinates are (x, y, z) with y up. The roof plane meets the outer wall
 * face at height `h` and continues down past it by the overhang.
 */
export function roofFaces(r: RoofRect, h: number, roof: Roof): RoofFaces {
  const o = roof.overhang;
  const alongX = roof.ridge === 'x' || (roof.ridge === 'auto' && r.maxX - r.minX >= r.maxZ - r.minZ);
  // Work in (u along the ridge, v across it), then map back to (x, z).
  const u0 = (alongX ? r.minX : r.minZ) - o, u1 = (alongX ? r.maxX : r.maxZ) + o;
  const w0 = alongX ? r.minZ : r.minX, w1 = alongX ? r.maxZ : r.maxX;
  const v0 = w0 - o, v1 = w1 + o;
  const P = (u: number, y: number, v: number): V3 => (alongX ? [u, y, v] : [v, y, u]);

  if (roof.type === 'flat') {
    const y = h;
    const quad = [P(u0, y, v0), P(u0, y, v1), P(u1, y, v1), P(u1, y, v0)];
    return { slopes: [orient(quad)], gables: [], ridgeHeight: y };
  }

  const tan = Math.tan((roof.pitch * Math.PI) / 180);
  const half = (w1 - w0) / 2;
  const vm = (w0 + w1) / 2;
  const eave = h - o * tan;
  const ridgeY = h + half * tan;
  const slopes: V3[][] = [];
  const gables: V3[][] = [];

  if (roof.type === 'gable') {
    slopes.push(orient([P(u0, eave, v0), P(u1, eave, v0), P(u1, ridgeY, vm), P(u0, ridgeY, vm)]));
    slopes.push(orient([P(u1, eave, v1), P(u0, eave, v1), P(u0, ridgeY, vm), P(u1, ridgeY, vm)]));
    const g0 = alongX ? r.minX : r.minZ, g1 = alongX ? r.maxX : r.maxZ;
    for (const g of [g0, g1]) gables.push([P(g, h, w0), P(g, h, w1), P(g, ridgeY, vm)]);
  } else {
    // Hip: the ridge is shortened so the end slopes have the same pitch.
    const span = v1 - v0;
    const inset = Math.min(span / 2, (u1 - u0) / 2);
    const r0 = u0 + inset, r1 = u1 - inset;
    const ry = eave + inset * tan;
    slopes.push(orient([P(u0, eave, v0), P(u1, eave, v0), P(r1, ry, vm), P(r0, ry, vm)]));
    slopes.push(orient([P(u1, eave, v1), P(u0, eave, v1), P(r0, ry, vm), P(r1, ry, vm)]));
    slopes.push(orient([P(u0, eave, v1), P(u0, eave, v0), P(r0, ry, vm)]));
    slopes.push(orient([P(u1, eave, v0), P(u1, eave, v1), P(r1, ry, vm)]));
    return { slopes: slopes.filter((f) => area(f) > 1e-6), gables, ridgeHeight: ry };
  }
  return { slopes, gables, ridgeHeight: ridgeY };
}

/** Ensure each roof polygon faces upwards (positive Y normal). */
function orient(poly: V3[]): V3[] {
  return normalY(poly) < 0 ? [...poly].reverse() : poly;
}

/** Y component of the polygon normal (Newell's method). */
function normalY(poly: V3[]): number {
  let ny = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    ny += (a[2] - b[2]) * (a[0] + b[0]);
  }
  return ny;
}

function area(poly: V3[]): number {
  let ax = 0, ay = 0, az = 0;
  for (let i = 1; i < poly.length - 1; i++) {
    const a = poly[0], b = poly[i], c = poly[i + 1];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    ax += u[1] * v[2] - u[2] * v[1]; ay += u[2] * v[0] - u[0] * v[2]; az += u[0] * v[1] - u[1] * v[0];
  }
  return Math.hypot(ax, ay, az) / 2;
}
