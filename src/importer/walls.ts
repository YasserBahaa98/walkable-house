// Wall recognition: clustering floors, pairing double lines, merging, openings, joints and gaps.
import type { Opening, OpeningKind, Vec2, Wall } from '../model/types';
import { uid } from '../model/ids';
import { type Bounds, dist, pointSegment, round3 as round } from '../geometry/math';
import { angDiff, type Hint, type Line, lineIntersection } from './shared';

export function clusterLines(lines: Line[], tol: number): number[][] {
  const parent = lines.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const cell = 2;
  const grid = new Map<string, number[]>();
  lines.forEach((l, i) => {
    const x0 = Math.floor((Math.min(l.a.x, l.b.x) - tol) / cell), x1 = Math.floor((Math.max(l.a.x, l.b.x) + tol) / cell);
    const z0 = Math.floor((Math.min(l.a.z, l.b.z) - tol) / cell), z1 = Math.floor((Math.max(l.a.z, l.b.z) + tol) / cell);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const key = `${x},${z}`;
      const list = grid.get(key);
      if (list) list.push(i); else grid.set(key, [i]);
    }
  });
  for (const list of grid.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (find(a) === find(b)) continue;
        if (segDist(lines[a], lines[b]) < tol) parent[find(a)] = find(b);
      }
    }
  }
  const groups = new Map<number, number[]>();
  lines.forEach((_, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i); else groups.set(r, [i]);
  });
  return [...groups.values()];
}

function segDist(p: Line, q: Line): number {
  if (segmentsIntersect(p.a, p.b, q.a, q.b)) return 0;
  return Math.min(pointSegment(p.a, q.a, q.b).d, pointSegment(p.b, q.a, q.b).d, pointSegment(q.a, p.a, p.b).d, pointSegment(q.b, p.a, p.b).d);
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => Math.sign((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

// --------------------------------------------------------- wall pairing

interface Candidate { i: number; j: number; d: number; o0: number; o1: number }

/** Turn double-line walls into centreline walls with thickness. */
export function pairWalls(lines: Line[], opts: { minThickness: number; maxThickness: number }): Wall[] {
  const buckets = new Map<number, number[]>();
  lines.forEach((l, i) => {
    const b = Math.round((l.ang * 180) / Math.PI) % 180;
    const list = buckets.get(b);
    if (list) list.push(i); else buckets.set(b, [i]);
  });
  const cands: Candidate[] = [];
  for (const [b, list] of buckets) {
    const near = [...list, ...(buckets.get((b + 1) % 180) ?? []), ...(buckets.get((b + 179) % 180) ?? [])];
    for (const i of list) {
      const L = lines[i];
      for (const j of near) {
        if (j <= i && list.includes(j)) continue;
        if (j === i) continue;
        const M = lines[j];
        if (angDiff(L.ang, M.ang) > 0.035) continue;
        const mid = { x: (M.a.x + M.b.x) / 2, z: (M.a.z + M.b.z) / 2 };
        const d = Math.abs((mid.x - L.a.x) * L.uz - (mid.z - L.a.z) * L.ux);
        if (d < opts.minThickness || d > opts.maxThickness) continue;
        const t1 = (M.a.x - L.a.x) * L.ux + (M.a.z - L.a.z) * L.uz;
        const t2 = (M.b.x - L.a.x) * L.ux + (M.b.z - L.a.z) * L.uz;
        const o0 = Math.max(0, Math.min(t1, t2)), o1 = Math.min(L.len, Math.max(t1, t2));
        if (o1 - o0 < Math.max(0.08, d * 0.6)) continue;
        cands.push({ i, j, d, o0, o1 });
      }
    }
  }
  cands.sort((a, b) => a.d - b.d || (b.o1 - b.o0) - (a.o1 - a.o0));
  const covered = lines.map(() => [] as [number, number][]);
  const walls: Wall[] = [];
  for (const c of cands) {
    const L = lines[c.i], M = lines[c.j];
    const projM = (t: number) => {
      const p = { x: L.a.x + L.ux * t, z: L.a.z + L.uz * t };
      return (p.x - M.a.x) * M.ux + (p.z - M.a.z) * M.uz;
    };
    const m0 = Math.min(projM(c.o0), projM(c.o1)), m1 = Math.max(projM(c.o0), projM(c.o1));
    if (coveredFraction(covered[c.i], c.o0, c.o1) > 0.5 || coveredFraction(covered[c.j], m0, m1) > 0.5) continue;
    covered[c.i].push([c.o0, c.o1]);
    covered[c.j].push([m0, m1]);
    // Offset towards the partner line by half the thickness.
    const side = Math.sign((M.a.x - L.a.x) * L.uz - (M.a.z - L.a.z) * L.ux) || 1;
    const nx = L.uz * side, nz = -L.ux * side;
    const h = c.d / 2;
    walls.push({
      id: uid('w'),
      a: { x: L.a.x + L.ux * c.o0 + nx * h, z: L.a.z + L.uz * c.o0 + nz * h },
      b: { x: L.a.x + L.ux * c.o1 + nx * h, z: L.a.z + L.uz * c.o1 + nz * h },
      thickness: round(c.d),
    });
  }
  return walls;
}

function coveredFraction(list: [number, number][], a: number, b: number): number {
  if (b <= a) return 1;
  let sum = 0;
  for (const [s, e] of list) sum += Math.max(0, Math.min(b, e) - Math.max(a, s));
  return sum / (b - a);
}

// ------------------------------------------------------ collinear merge

export interface Gap { wall: Wall; offset: number; width: number; center: Vec2; ux: number; uz: number }

/**
 * Merge collinear wall pieces. Short gaps between pieces become openings
 * (doors/windows/passages) on the merged wall.
 */
export function mergeCollinear(walls: Wall[], canBridgeWide: (a: Vec2, b: Vec2) => boolean = () => false): { walls: Wall[]; gaps: Gap[] } {
  type Group = { ang: number; off: number; t: number; ux: number; uz: number; members: Wall[] };
  const groups: Group[] = [];
  for (const w of walls) {
    const len = dist(w.a, w.b);
    if (len < 1e-3) continue;
    let ux = (w.b.x - w.a.x) / len, uz = (w.b.z - w.a.z) / len;
    if (ux < -1e-9 || (Math.abs(ux) < 1e-9 && uz < 0)) { ux = -ux; uz = -uz; }
    const ang = Math.atan2(uz, ux);
    const off = w.a.x * uz - w.a.z * ux;
    const g = groups.find((g) => angDiff(g.ang, ang) < 0.03 && Math.abs(g.off - off) < 0.05 && Math.abs(g.t - w.thickness) < 0.05);
    if (g) g.members.push(w); else groups.push({ ang, off, t: w.thickness, ux, uz, members: [w] });
  }
  const out: Wall[] = [];
  const gaps: Gap[] = [];
  for (const g of groups) {
    const proj = (p: Vec2) => p.x * g.ux + p.z * g.uz;
    const ivs = g.members.map((w) => {
      const s = proj(w.a), e = proj(w.b);
      return { s: Math.min(s, e), e: Math.max(s, e), t: w.thickness };
    }).sort((a, b) => a.s - b.s);
    const avgOff = g.members.reduce((s, w) => s + (w.a.x * g.uz - w.a.z * g.ux), 0) / g.members.length;
    const point = (t: number) => ({ x: g.ux * t + g.uz * avgOff, z: g.uz * t - g.ux * avgOff });
    let cur = { ...ivs[0], gaps: [] as [number, number][] };
    const flush = () => {
      const w: Wall = { id: uid('w'), a: point(cur.s), b: point(cur.e), thickness: round(cur.t) };
      out.push(w);
      for (const [gs, ge] of cur.gaps) {
        gaps.push({ wall: w, offset: (gs + ge) / 2 - cur.s, width: ge - gs, center: point((gs + ge) / 2), ux: g.ux, uz: g.uz });
      }
    };
    for (let i = 1; i < ivs.length; i++) {
      const iv = ivs[i];
      const gap = iv.s - cur.e;
      if (gap <= 0.03) {
        cur.e = Math.max(cur.e, iv.e);
        cur.t = Math.max(cur.t, iv.t);
      } else if (gap >= 0.45 && (gap <= 3.6 || (gap <= 9 && canBridgeWide(point(cur.e), point(iv.s))))) {
        cur.gaps.push([cur.e, iv.s]);
        cur.e = Math.max(cur.e, iv.e);
      } else {
        flush();
        cur = { ...iv, gaps: [] };
      }
    }
    flush();
  }
  return { walls: out, gaps };
}


export function classifyGap(
  g: Gap, doors: Hint[], windows: Hint[], arcs: { p: Vec2; r: number; block: string }[], other: Line[],
): Opening {
  const halfW = g.width / 2;
  const endA = { x: g.center.x - g.ux * halfW, z: g.center.z - g.uz * halfW };
  const endB = { x: g.center.x + g.ux * halfW, z: g.center.z + g.uz * halfW };
  let kind: OpeningKind = 'opening';
  let hinge: 'start' | 'end' | undefined;

  const doorInsert = doors.find((i) => dist(i.p, g.center) < Math.max(1.0, g.width));
  const arc = arcs.find((a) => Math.abs(a.r - g.width) < 0.35 && (dist(a.p, endA) < 0.3 || dist(a.p, endB) < 0.3));
  const win = windows.find((i) => dist(i.p, g.center) < Math.max(0.4, halfW) && Math.max(i.wm, i.hm) > g.width * 0.5);
  if (doorInsert || arc) {
    kind = 'door';
    if (arc) hinge = dist(arc.p, endA) < dist(arc.p, endB) ? 'start' : 'end';
  } else if (win) {
    kind = 'window';
  } else {
    const thickness = g.wall.thickness;
    const glazing = other.filter((l) => {
      if (angDiff(l.ang, Math.atan2(g.uz, g.ux) < 0 ? Math.atan2(g.uz, g.ux) + Math.PI : Math.atan2(g.uz, g.ux)) > 0.05) return false;
      const mid = { x: (l.a.x + l.b.x) / 2, z: (l.a.z + l.b.z) / 2 };
      const along = (mid.x - g.center.x) * g.ux + (mid.z - g.center.z) * g.uz;
      const across = Math.abs((mid.x - g.center.x) * g.uz - (mid.z - g.center.z) * g.ux);
      return Math.abs(along) < halfW && across <= thickness / 2 + 0.05 && l.len > g.width * 0.5;
    });
    if (glazing.length >= 2) kind = 'window';
  }

  const id = uid('o');
  if (kind === 'door') {
    return { id, wallId: g.wall.id, kind, offset: g.offset, width: g.width, height: 2.1, sill: 0, hinge: hinge ?? 'start', swing: 'left' };
  }
  if (kind === 'window') {
    const tall = g.width > 2.0; // wide glazing is usually a sliding door
    return { id, wallId: g.wall.id, kind, offset: g.offset, width: g.width, height: tall ? 2.1 : 1.25, sill: tall ? 0.02 : 0.9 };
  }
  return { id, wallId: g.wall.id, kind, offset: g.offset, width: g.width, height: 2.1, sill: 0 };
}

// ---------------------------------------------------------- joint snap

/**
 * Extend/trim wall ends to meet neighbouring walls at their centreline intersection.
 * Opening offsets (measured from each wall's start) are kept in place.
 */
export function snapJoints(walls: Wall[], openings: Opening[] = []) {
  for (let pass = 0; pass < 2; pass++) {
    for (const w of walls) {
      for (const end of ['a', 'b'] as const) {
        const p = w[end];
        const other = end === 'a' ? w.b : w.a;
        let best: Vec2 | null = null, bestD = Infinity;
        for (const o of walls) {
          if (o === w) continue;
          const x = lineIntersection(other, p, o.a, o.b);
          if (!x) continue;
          const reach = (o.thickness + w.thickness) / 2 + 0.12;
          const dEnd = dist(x, p);
          if (dEnd > reach) continue;
          // The intersection must lie on (or just beyond) the other wall.
          const { d: off } = pointSegment(x, o.a, o.b);
          if (off > o.thickness / 2 + 0.12) continue;
          // Do not flip the wall's direction.
          if ((x.x - other.x) * (p.x - other.x) + (x.z - other.z) * (p.z - other.z) <= 0) continue;
          if (dEnd < bestD) { bestD = dEnd; best = x; }
        }
        if (best) {
          if (end === 'a') {
            const len = dist(w.a, w.b) || 1;
            const ux = (w.b.x - w.a.x) / len, uz = (w.b.z - w.a.z) / len;
            const shift = (w.a.x - best.x) * ux + (w.a.z - best.z) * uz;
            for (const o of openings) if (o.wallId === w.id) o.offset += shift;
          }
          p.x = round(best.x); p.z = round(best.z);
        }
      }
    }
  }
}

/**
 * Doors drawn between a wall end and a perpendicular wall: a swing arc centred on a
 * wall end. Extend the wall across the doorway and add a door there.
 */
export function doorsAtWallEnds(walls: Wall[], openings: Opening[], arcs: { p: Vec2; r: number }[]) {
  const doorEnds: Vec2[] = [];
  const recordDoorEnds = () => {
    doorEnds.length = 0;
    for (const o of openings) {
      if (o.kind !== 'door') continue;
      const w = walls.find((x) => x.id === o.wallId);
      if (!w) continue;
      const len = dist(w.a, w.b) || 1;
      const ux = (w.b.x - w.a.x) / len, uz = (w.b.z - w.a.z) / len;
      for (const t of [o.offset - o.width / 2, o.offset + o.width / 2]) doorEnds.push({ x: w.a.x + ux * t, z: w.a.z + uz * t });
    }
  };
  recordDoorEnds();

  type Fix = { err: number; apply: () => void };
  for (const arc of arcs) {
    if (doorEnds.some((p) => dist(p, arc.p) < 0.35)) continue;
    let best: Fix | null = null;
    const consider = (f: Fix) => { if (!best || f.err < best.err) best = f; };

    for (const w of walls) {
      for (const end of ['a', 'b'] as const) {
        const p = w[end];
        if (dist(p, arc.p) > arc.r + 0.4) continue;
        const from = end === 'a' ? w.b : w.a;
        const len0 = dist(from, p);
        if (len0 < 0.1) continue;
        const ux = (p.x - from.x) / len0, uz = (p.z - from.z) / len0;

        // (1) Extend this wall across the doorway until it meets another wall.
        let hitT = Infinity, face = 0;
        for (const o of walls) {
          if (o === w) continue;
          const x = lineIntersection(from, p, o.a, o.b);
          if (x) {
            const t = (x.x - p.x) * ux + (x.z - p.z) * uz;
            if (t < 0.45 || t > 1.9 || pointSegment(x, o.a, o.b).d > o.thickness / 2 + 0.05) continue;
            if (t < hitT) { hitT = t; face = o.thickness / 2; }
          } else {
            for (const q of [o.a, o.b]) {
              const t = (q.x - p.x) * ux + (q.z - p.z) * uz;
              const off = Math.abs((q.x - p.x) * uz - (q.z - p.z) * ux);
              if (off <= 0.06 && t >= 0.45 && t < hitT && t <= 1.9) { hitT = t; face = 0; }
            }
          }
        }
        if (Number.isFinite(hitT)) {
          const width = hitT - face;
          const far = { x: p.x + ux * width, z: p.z + uz * width };
          const hingeErr = Math.min(dist(arc.p, p), dist(arc.p, far));
          const err = hingeErr + Math.abs(width - arc.r) * 0.5;
          if (hingeErr < 0.35 && Math.abs(width - arc.r) < 0.4 && width >= 0.45 && width <= 1.6) {
            const hingeNearP = dist(arc.p, p) < dist(arc.p, far);
            consider({
              err,
              apply: () => {
                const np = { x: round(p.x + ux * hitT), z: round(p.z + uz * hitT) };
                const id = uid('o');
                if (end === 'b') {
                  w.b = np;
                  openings.push({ id, wallId: w.id, kind: 'door', offset: len0 + width / 2, width, height: 2.1, sill: 0, hinge: hingeNearP ? 'start' : 'end', swing: 'left' });
                } else {
                  for (const o of openings) if (o.wallId === w.id) o.offset += hitT;
                  w.a = np;
                  openings.push({ id, wallId: w.id, kind: 'door', offset: face + width / 2, width, height: 2.1, sill: 0, hinge: hingeNearP ? 'end' : 'start', swing: 'left' });
                }
              },
            });
          }
        }

        // (2) Bridge to another wall's end with a new door-sized wall segment.
        if (dist(p, arc.p) < 0.35) {
          for (const o of walls) {
            if (o === w) continue;
            for (const q of [o.a, o.b]) {
              const span = dist(p, q);
              if (span < 0.5 || span > 1.6 || Math.abs(span - arc.r) > 0.45) continue;
              consider({
                err: 0.15 + dist(p, arc.p) + Math.abs(span - arc.r) * 0.5,
                apply: () => {
                  const nw: Wall = { id: uid('w'), a: { ...p }, b: { ...q }, thickness: w.thickness };
                  walls.push(nw);
                  openings.push({ id: uid('o'), wallId: nw.id, kind: 'door', offset: span / 2, width: Math.max(0.4, span - 0.02), height: 2.1, sill: 0, hinge: 'start', swing: 'left' });
                },
              });
            }
          }
        }
      }
    }
    const chosen = best as Fix | null;
    if (chosen) { chosen.apply(); recordDoorEnds(); }
  }
}

/**
 * Close short gaps left at free wall ends (often a wall drawn on another layer,
 * or a doorway without a door symbol). A free end that points at another wall
 * within 1.6 m is extended to it. On the building's outline the gap becomes
 * solid wall; inside, gaps wide enough to walk through become passages.
 */
export function closeGaps(walls: Wall[], openings: Opening[], bounds: Bounds) {
  const free = (w: Wall, p: Vec2) => !walls.some((o) => o !== w && pointSegment(p, o.a, o.b).d < o.thickness / 2 + 0.04);
  const onOutline = (p: Vec2, q: Vec2) => {
    const near = (v: number, edge: number) => Math.abs(v - edge) < 0.45;
    return (near(p.x, bounds.minX) && near(q.x, bounds.minX)) || (near(p.x, bounds.maxX) && near(q.x, bounds.maxX))
      || (near(p.z, bounds.minZ) && near(q.z, bounds.minZ)) || (near(p.z, bounds.maxZ) && near(q.z, bounds.maxZ));
  };
  for (const w of [...walls]) {
    for (const end of ['a', 'b'] as const) {
      const p = w[end];
      if (!free(w, p)) continue;
      const from = end === 'a' ? w.b : w.a;
      const len0 = dist(from, p);
      if (len0 < 0.3) continue;
      const ux = (p.x - from.x) / len0, uz = (p.z - from.z) / len0;
      let bestT = Infinity, face = 0;
      for (const o of walls) {
        if (o === w) continue;
        const x = lineIntersection(from, p, o.a, o.b);
        if (x) {
          const t = (x.x - p.x) * ux + (x.z - p.z) * uz;
          if (t > 0.02 && t < bestT && t <= 1.6 && pointSegment(x, o.a, o.b).d <= o.thickness / 2 + 0.05) { bestT = t; face = o.thickness / 2; }
        } else {
          for (const q of [o.a, o.b]) {
            const t = (q.x - p.x) * ux + (q.z - p.z) * uz;
            const off = Math.abs((q.x - p.x) * uz - (q.z - p.z) * ux);
            if (off <= 0.06 && t > 0.02 && t < bestT && t <= 1.6) { bestT = t; face = 0; }
          }
        }
      }
      if (!Number.isFinite(bestT)) continue;
      const gap = bestT - face;
      const np = { x: round(p.x + ux * bestT), z: round(p.z + uz * bestT) };
      const passage = gap >= 0.5 && !onOutline(p, np);
      if (end === 'b') {
        w.b = np;
        if (passage) openings.push({ id: uid('o'), wallId: w.id, kind: 'opening', offset: len0 + gap / 2, width: gap, height: 2.1, sill: 0 });
      } else {
        for (const o of openings) if (o.wallId === w.id) o.offset += bestT;
        w.a = np;
        if (passage) openings.push({ id: uid('o'), wallId: w.id, kind: 'opening', offset: face + gap / 2, width: gap, height: 2.1, sill: 0 });
      }
    }
  }
}
