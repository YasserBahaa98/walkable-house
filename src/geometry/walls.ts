import type { Level, Opening, Wall } from '../model/types';
import { type Bounds, emptyBounds, growBounds, type Obb, pointSegment, round3 as round, segmentObb } from './math';

export const JOIN_TOL = 0.03;

export const wallLength = (w: Wall) => Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);

export function wallDir(w: Wall): { ux: number; uz: number; nx: number; nz: number } {
  const len = wallLength(w) || 1;
  const ux = (w.b.x - w.a.x) / len, uz = (w.b.z - w.a.z) / len;
  // Left-hand normal of a→b in plan coordinates.
  return { ux, uz, nx: uz, nz: -ux };
}

/** Point at distance `t` metres along the wall from `a`. */
function wallPoint(w: Wall, t: number) {
  const { ux, uz } = wallDir(w);
  return { x: w.a.x + ux * t, z: w.a.z + uz * t };
}

/**
 * How far each wall end should extend so that corners and T-junctions close
 * cleanly: half the thickness of the widest wall meeting at that end.
 */
export function endExtensions(walls: Wall[]): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  for (const w of walls) {
    const ext: [number, number] = [0, 0];
    [w.a, w.b].forEach((p, i) => {
      for (const o of walls) {
        if (o === w) continue;
        const touches = Math.hypot(o.a.x - p.x, o.a.z - p.z) < JOIN_TOL
          || Math.hypot(o.b.x - p.x, o.b.z - p.z) < JOIN_TOL
          || pointSegment(p, o.a, o.b).d < JOIN_TOL;
        if (touches) ext[i] = Math.max(ext[i], o.thickness / 2);
      }
    });
    out.set(w.id, ext);
  }
  return out;
}

export interface OpeningSpan { opening: Opening; from: number; to: number }

/** Openings on a wall, clamped to the wall and sorted along it. Overlaps are trimmed. */
export function openingSpans(w: Wall, openings: Opening[]): OpeningSpan[] {
  const len = wallLength(w);
  const spans = openings
    .filter((o) => o.wallId === w.id)
    .map((o) => {
      const half = Math.min(o.width, len) / 2;
      const c = Math.min(Math.max(o.offset, half), len - half);
      return { opening: o, from: c - half, to: c + half };
    })
    .sort((a, b) => a.from - b.from);
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].from < spans[i - 1].to) spans[i].from = spans[i - 1].to;
  }
  return spans.filter((s) => s.to - s.from > 0.02);
}

export interface WallPiece { from: number; to: number; bottom: number; top: number }

/** Solid parts of a wall as boxes in wall-local coordinates (along, vertical). */
export function wallPieces(w: Wall, openings: Opening[], height: number, ext: [number, number] = [0, 0]): WallPiece[] {
  const len = wallLength(w);
  const pieces: WallPiece[] = [];
  let cursor = -ext[0];
  for (const s of openingSpans(w, openings)) {
    if (s.from > cursor + 1e-4) pieces.push({ from: cursor, to: s.from, bottom: 0, top: height });
    const o = s.opening;
    const bottom = Math.min(o.sill, height);
    const top = Math.min(o.sill + o.height, height);
    if (bottom > 1e-3) pieces.push({ from: s.from, to: s.to, bottom: 0, top: bottom });
    if (top < height - 1e-3) pieces.push({ from: s.from, to: s.to, bottom: top, top: height });
    cursor = s.to;
  }
  if (len + ext[1] > cursor + 1e-4) pieces.push({ from: cursor, to: len + ext[1], bottom: 0, top: height });
  return pieces;
}

/** Boxes that block walking: walls minus door/passage gaps. Windows stay solid. */
export function solidObbs(level: Level): Obb[] {
  const ext = endExtensions(level.walls);
  const out: Obb[] = [];
  for (const w of level.walls) {
    const [ea, eb] = ext.get(w.id) ?? [0, 0];
    const len = wallLength(w);
    const gaps = openingSpans(w, level.openings).filter((s) => s.opening.kind !== 'window' && s.opening.sill < 0.3);
    let cursor = -ea;
    const segs: [number, number][] = [];
    for (const g of gaps) {
      if (g.from > cursor) segs.push([cursor, g.from]);
      cursor = Math.max(cursor, g.to);
    }
    if (len + eb > cursor) segs.push([cursor, len + eb]);
    const { ux, uz } = wallDir(w);
    for (const [s0, s1] of segs) {
      const a = { x: w.a.x + ux * s0, z: w.a.z + uz * s0 };
      const b = { x: w.a.x + ux * s1, z: w.a.z + uz * s1 };
      if (s1 - s0 > 1e-3) out.push(segmentObb(a, b, w.thickness));
    }
  }
  return out;
}

export function wallObb(w: Wall, ext: [number, number] = [0, 0]): Obb {
  return segmentObb(w.a, w.b, w.thickness, ext[0], ext[1]);
}

export function levelBounds(level: Level): Bounds {
  const b = emptyBounds();
  for (const w of level.walls) {
    const pad = w.thickness / 2;
    for (const p of [w.a, w.b]) {
      growBounds(b, p.x - pad, p.z - pad);
      growBounds(b, p.x + pad, p.z + pad);
    }
  }
  for (const i of level.items) {
    const r = Math.hypot(i.w, i.d) / 2;
    growBounds(b, i.x - r, i.z - r);
    growBounds(b, i.x + r, i.z + r);
  }
  for (const s of level.stairs) {
    const r = Math.hypot(s.width, s.length) / 2;
    growBounds(b, s.x - r, s.z - r);
    growBounds(b, s.x + r, s.z + r);
  }
  return b;
}

/**
 * Split a wall into two at distance `t` from its start, moving openings to
 * whichever half contains their centre. Returns the new wall ids.
 */
export function splitWall(level: Level, wallId: string, t: number, newId: () => string): [string, string] | null {
  const w = level.walls.find((x) => x.id === wallId);
  if (!w) return null;
  const len = wallLength(w);
  if (t <= 0.05 || t >= len - 0.05) return null;
  const p = wallPoint(w, t);
  const second: Wall = { ...w, id: newId(), a: { ...p }, b: { ...w.b } };
  w.b = { ...p };
  for (const o of level.openings) {
    if (o.wallId !== w.id) continue;
    if (o.offset > t) { o.wallId = second.id; o.offset -= t; }
  }
  level.walls.splice(level.walls.indexOf(w) + 1, 0, second);
  return [w.id, second.id];
}

/**
 * Bend a wall into a circular arc made of short straight segments.
 * `sagitta` is the arc's bulge at the middle (positive: towards the wall's
 * left normal). Endpoints stay put so connections are preserved; openings
 * move to the segment that contains them. Returns the new wall ids.
 */
export function curveWall(level: Level, wallId: string, sagitta: number, newId: () => string): string[] | null {
  const w = level.walls.find((x) => x.id === wallId);
  if (!w || Math.abs(sagitta) < 0.01) return null;
  const c = wallLength(w);
  if (c < 0.3 || Math.abs(sagitta) > c / 2) return null;
  const { nx, nz } = wallDir(w);
  const mid = { x: (w.a.x + w.b.x) / 2, z: (w.a.z + w.b.z) / 2 };
  const s = sagitta;
  const R = (c * c / 4 + s * s) / (2 * Math.abs(s));
  const ctr = { x: mid.x + nx * (s - Math.sign(s) * R), z: mid.z + nz * (s - Math.sign(s) * R) };
  const a0 = Math.atan2(w.a.z - ctr.z, w.a.x - ctr.x);
  let sweep = 4 * Math.atan((2 * Math.abs(s)) / c);
  // Pick the sweep direction that passes through the arc's middle point.
  const apex = { x: mid.x + nx * s, z: mid.z + nz * s };
  const at = (t: number, sw: number) => ({ x: ctr.x + R * Math.cos(a0 + sw * t), z: ctr.z + R * Math.sin(a0 + sw * t) });
  const m1 = at(0.5, sweep), m2 = at(0.5, -sweep);
  if (Math.hypot(m2.x - apex.x, m2.z - apex.z) < Math.hypot(m1.x - apex.x, m1.z - apex.z)) sweep = -sweep;
  const arcLen = Math.abs(sweep) * R;
  const n = Math.max(6, Math.min(32, Math.round(arcLen / 0.35)));
  const pts = Array.from({ length: n + 1 }, (_, i) => (i === 0 ? { ...w.a } : i === n ? { ...w.b } : at(i / n, sweep)));
  const segs: Wall[] = [];
  for (let i = 0; i < n; i++) {
    segs.push({ ...w, id: i === 0 ? w.id : newId(), a: { x: round(pts[i].x), z: round(pts[i].z) }, b: { x: round(pts[i + 1].x), z: round(pts[i + 1].z) } });
  }
  // Move openings: map their position along the old chord to arc length.
  const segLen = segs.map(wallLength);
  for (const o of level.openings) {
    if (o.wallId !== w.id) continue;
    let pos = (o.offset / c) * segLen.reduce((a, b) => a + b, 0);
    let k = 0;
    while (k < n - 1 && pos > segLen[k]) { pos -= segLen[k]; k++; }
    o.wallId = segs[k].id;
    o.offset = Math.min(Math.max(pos, o.width / 2), segLen[k] - o.width / 2);
  }
  level.walls.splice(level.walls.indexOf(w), 1, ...segs);
  return segs.map((x) => x.id);
}
