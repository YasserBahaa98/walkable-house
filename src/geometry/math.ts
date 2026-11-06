import type { Vec2 } from '../model/types';

/**
 * Oriented box in the plan. `rot` follows the Three.js Y-rotation convention:
 * local (x, z) maps to world (cx + x·cos + z·sin, cz − x·sin + z·cos).
 */
export interface Obb { cx: number; cz: number; hx: number; hz: number; rot: number }

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
/** Round to millimetres (the precision stored in projects). */
export const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Normalise an angle to (−π, π], rounded to stored precision. */
export function normAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r <= -Math.PI) r += Math.PI * 2;
  return round3(r);
}

export function toLocal(o: Obb, x: number, z: number): [number, number] {
  const c = Math.cos(o.rot), s = Math.sin(o.rot);
  const dx = x - o.cx, dz = z - o.cz;
  return [dx * c - dz * s, dx * s + dz * c];
}

export function toWorld(o: Obb, lx: number, lz: number): [number, number] {
  const c = Math.cos(o.rot), s = Math.sin(o.rot);
  return [o.cx + lx * c + lz * s, o.cz - lx * s + lz * c];
}

export function obbCorners(o: Obb): Vec2[] {
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sz]) => {
    const [x, z] = toWorld(o, sx * o.hx, sz * o.hz);
    return { x, z };
  });
}

export function pointInObb(o: Obb, x: number, z: number, pad = 0): boolean {
  const [lx, lz] = toLocal(o, x, z);
  return Math.abs(lx) <= o.hx + pad && Math.abs(lz) <= o.hz + pad;
}

/**
 * Push a circle out of a box. Returns the corrected centre, or null if they do not overlap.
 */
export function pushCircle(o: Obb, x: number, z: number, r: number): [number, number] | null {
  const [lx, lz] = toLocal(o, x, z);
  const qx = clamp(lx, -o.hx, o.hx), qz = clamp(lz, -o.hz, o.hz);
  const ex = lx - qx, ez = lz - qz;
  const d = Math.hypot(ex, ez);
  if (d >= r) return null;
  let nx: number, nz: number;
  if (d > 1e-9) {
    nx = qx + (ex / d) * r;
    nz = qz + (ez / d) * r;
  } else {
    // Centre is inside the box: leave along the axis of least penetration.
    const px = o.hx - Math.abs(lx), pz = o.hz - Math.abs(lz);
    if (px < pz) { nx = Math.sign(lx || 1) * (o.hx + r); nz = lz; } else { nx = lx; nz = Math.sign(lz || 1) * (o.hz + r); }
  }
  return toWorld(o, nx, nz);
}

/** Penetration depth between two boxes along the separating axes (0 = no overlap). */
export function obbOverlap(a: Obb, b: Obb): number {
  const ca = obbCorners(a), cb = obbCorners(b);
  const axes = [a.rot, a.rot + Math.PI / 2, b.rot, b.rot + Math.PI / 2].map((r) => ({ x: Math.cos(r), z: -Math.sin(r) }));
  let min = Infinity;
  for (const ax of axes) {
    const pa = ca.map((p) => p.x * ax.x + p.z * ax.z);
    const pb = cb.map((p) => p.x * ax.x + p.z * ax.z);
    const overlap = Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb));
    if (overlap <= 0) return 0;
    min = Math.min(min, overlap);
  }
  return min;
}

/** Distance from point p to segment ab, plus the projection parameter t in [0,1]. */
export function pointSegment(p: Vec2, a: Vec2, b: Vec2): { d: number; t: number } {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 ? clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / len2, 0, 1) : 0;
  return { d: Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)), t };
}

/** Three.js Y rotation that aligns local +X with the direction a→b. */
const segmentRot = (a: Vec2, b: Vec2) => -Math.atan2(b.z - a.z, b.x - a.x);

/** Box spanning segment ab with the given thickness, optionally extended at each end. */
export function segmentObb(a: Vec2, b: Vec2, thickness: number, extA = 0, extB = 0): Obb {
  const len = dist(a, b);
  const ux = len ? (b.x - a.x) / len : 1, uz = len ? (b.z - a.z) / len : 0;
  const mid = (len + extB - extA) / 2;
  return {
    cx: a.x + ux * mid, cz: a.z + uz * mid,
    hx: (len + extA + extB) / 2, hz: thickness / 2,
    rot: segmentRot(a, b),
  };
}

export interface Bounds { minX: number; minZ: number; maxX: number; maxZ: number }
export const emptyBounds = (): Bounds => ({ minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity });
export function growBounds(b: Bounds, x: number, z: number) {
  if (x < b.minX) b.minX = x;
  if (x > b.maxX) b.maxX = x;
  if (z < b.minZ) b.minZ = z;
  if (z > b.maxZ) b.maxZ = z;
}
export const boundsValid = (b: Bounds) => b.minX <= b.maxX && b.minZ <= b.maxZ;
