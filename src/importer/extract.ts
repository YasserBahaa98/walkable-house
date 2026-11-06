import { guessFurniture, CATALOG } from '../model/catalog';
import { uid } from '../model/ids';
import type { Item, Level, Opening, OpeningKind, Project, Room, Stair, Vec2, Wall } from '../model/types';
import { type Bounds, emptyBounds, growBounds, pointSegment } from '../geometry/math';
import { regionAt } from '../geometry/rooms';
import type { CadDrawing, CadInsert, CadSegment } from './cadTypes';

// ----------------------------------------------------------------- options

export interface ExtractOptions {
  /** Metres per drawing unit. */
  scale: number;
  wallLayers: string[];
  minThickness: number;
  maxThickness: number;
}

export const UNIT_SCALES: { label: string; scale: number; insunits: number }[] = [
  { label: 'Metres', scale: 1, insunits: 6 },
  { label: 'Centimetres', scale: 0.01, insunits: 5 },
  { label: 'Millimetres', scale: 0.001, insunits: 4 },
  { label: 'Inches', scale: 0.0254, insunits: 1 },
  { label: 'Feet', scale: 0.3048, insunits: 2 },
];

const WALL_LAYER_RE = /wall|muro|mur(s|o)?\b|wand|pared|tabique|parede|v[æa]gg|mauer|^a-?wall|cloison/i;
const DOOR_RE = /puert|door|t[üu]r\b|t[üu]re|porte|d[øo]r\b|deur|porta/i;
const WINDOW_RE = /ventan|window|fen[eê]tre|fenster|vindu|janela|finestra/i;
const STAIR_RE = /escal|eslca|stair|trapp|treppe|escada|scala|step/i;
const UP_RE = /^(up|sube|subida|arriba|opp|hoch|monte|sobe)\b/i;
const DOWN_RE = /^(down|dn|baja|bajada|abajo|ned|runter|descend|desce)\b/i;
const NOT_ROOM_RE = /door|window|puerta|ventana|sliding|scale|escala|plan|planta|level|nivel|floor|north|norte|^\W*$|^(up|down|dn|sube|baja|n|s|e|w)$/i;

/**
 * Layers that look like walls by name. If none match, score each layer by how much
 * of its linework forms wall-like parallel pairs (double lines 8–50 cm apart).
 */
export function guessWallLayers(d: CadDrawing, scale = 1): string[] {
  const named = d.layers.filter((l) => WALL_LAYER_RE.test(l.name)).map((l) => l.name);
  if (named.length) return named;
  const byLayer = new Map<string, Line[]>();
  for (const s of d.segments) {
    if (s.b && s.b * scale <= 3) continue;
    const l = toPlan(s, scale);
    if (l.len < 0.05) continue;
    const list = byLayer.get(s.layer);
    if (list) list.push(l); else byLayer.set(s.layer, [l]);
  }
  const scored = [...byLayer.entries()].map(([name, lines]) => {
    const total = lines.reduce((sum, l) => sum + l.len, 0);
    const walls = pairWalls(lines, { minThickness: 0.08, maxThickness: 0.5 });
    const paired = walls.reduce((sum, w) => sum + dist(w.a, w.b), 0);
    return { name, paired, ratio: total ? (2 * paired) / total : 0 };
  }).filter((x) => x.paired > 10 && x.ratio > 0.35).sort((a, b) => b.paired - a.paired);
  if (scored.length) return scored.slice(0, 2).map((x) => x.name);
  return d.layers.slice(0, 1).map((l) => l.name);
}

/**
 * Pick the drawing unit. Walls are the strongest cue: double wall lines only
 * pair into plausible walls (7–60 cm thick) at the right scale. The declared
 * unit wins when it does nearly as well; drawing size is the fallback.
 */
export function guessScale(d: CadDrawing, wallLayers: string[]): number {
  const layers = new Set(wallLayers);
  // Prefer loose linework: blocks on wall layers are often appliances placed far away.
  const onLayer = d.segments.filter((s) => layers.has(s.layer));
  const loose = onLayer.filter((s) => !s.b);
  const pick = (loose.length >= 20 ? loose : onLayer)
    .map((s) => ({ s, len: Math.hypot(s.x2 - s.x1, s.y2 - s.y1) }))
    .sort((a, b) => b.len - a.len)
    .slice(0, 3000)
    .map((x) => x.s);
  if (!pick.length) return 1;
  const declared = UNIT_SCALES.find((u) => u.insunits === d.insunits);

  const scores = UNIT_SCALES.map((u) => {
    const lines = pick.map((s) => toPlan(s, u.scale)).filter((l) => l.len > 0.05 && l.len < 200);
    const paired = pairWalls(lines, { minThickness: 0.07, maxThickness: 0.6 }).reduce((sum, w) => sum + dist(w.a, w.b), 0);
    return { u, paired };
  });
  const best = scores.reduce((a, b) => (b.paired > a.paired ? b : a));
  if (best.paired > 2) {
    const dec = declared && scores.find((x) => x.u === declared);
    if (dec && dec.paired >= best.paired * 0.7) return dec.u.scale;
    return best.u.scale;
  }

  // No wall pairs at any scale (single-line drawing): fall back to overall size.
  const xs: number[] = [], ys: number[] = [];
  for (const s of pick) { xs.push(s.x1, s.x2); ys.push(s.y1, s.y2); }
  const extent = (v: number[]) => {
    v.sort((a, b) => a - b);
    return (v[Math.floor(v.length * 0.9)] - v[Math.floor(v.length * 0.1)]) * 1.25;
  };
  const size = Math.max(extent(xs), extent(ys));
  const plausible = (scale: number) => size * scale >= 3 && size * scale <= 300;
  if (declared && plausible(declared.scale)) return declared.scale;
  let fallback = 1, bestScore = Infinity;
  for (const u of UNIT_SCALES) {
    const score = Math.abs(Math.log((size * u.scale) / 15));
    if (score < bestScore) { bestScore = score; fallback = u.scale; }
  }
  return fallback;
}

// ---------------------------------------------------------------- results

export interface DetectedFloor {
  index: number;
  bounds: Bounds;
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  items: Item[];
  stairs: { stair: Stair; fromAbove: boolean }[];
  underlay: number[];
  wallLength: number;
}

export interface Extraction {
  floors: DetectedFloor[];
  warnings: string[];
}

interface Line { a: Vec2; b: Vec2; len: number; ux: number; uz: number; ang: number; layer: string }

const toPlan = (s: CadSegment, k: number): Line => {
  const a = { x: s.x1 * k, z: -s.y1 * k }, b = { x: s.x2 * k, z: -s.y2 * k };
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
  let ang = Math.atan2(uz, ux);
  if (ang < 0) ang += Math.PI;
  if (ang >= Math.PI - 1e-9) ang -= Math.PI;
  return { a, b, len, ux, uz, ang, layer: s.layer };
};

const angDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % Math.PI;
  return Math.min(d, Math.PI - d);
};

// ------------------------------------------------------------- extraction

export function extract(d: CadDrawing, opts: ExtractOptions): Extraction {
  const k = opts.scale;
  const layers = new Set(opts.wallLayers);
  const warnings: string[] = [];

  // Wall candidates: wall-layer lines that are not part of small blocks (furniture/appliances).
  const wallLines = d.segments
    .filter((s) => layers.has(s.layer) && (!s.b || s.b * k > 3))
    .map((s) => toPlan(s, k))
    .filter((l) => l.len > 0.05 && l.len < 200);

  if (!wallLines.length) {
    return { floors: [], warnings: ['No lines found on the selected wall layers.'] };
  }

  const clusters = clusterLines(wallLines, 2.2)
    .map((idx) => idx.map((i) => wallLines[i]))
    .filter((ls) => {
      const b = boundsOf(ls);
      const total = ls.reduce((s, l) => s + l.len, 0);
      return total >= 8 && b.maxX - b.minX >= 2 && b.maxZ - b.minZ >= 2;
    })
    .sort((a, b) => boundsOf(a).minX - boundsOf(b).minX);

  if (!clusters.length) {
    return { floors: [], warnings: ['Could not find any floor plan in the selected wall layers. Try other layers or units.'] };
  }
  if (clusters.length > 8) warnings.push(`Found ${clusters.length} separate drawings; showing the 8 largest.`);

  const allLines = d.segments.map((s) => toPlan(s, k)).filter((l) => l.len > 1e-4);
  const texts = d.texts.map((t) => ({ ...t, p: { x: t.x * k, z: -t.y * k } }));
  const inserts = d.inserts.map((ins) => ({ ...ins, p: { x: ins.cx * k, z: -ins.cy * k }, wm: ins.w * k, hm: ins.h * k }));
  // Door swings: roughly quarter arcs that are not part of furniture symbols.
  const arcs = d.arcs
    .filter((a) => {
      const sweep = a.sweep ?? Math.PI / 2;
      if (sweep < 1.2 || sweep > 1.95) return false;
      const block = a.block ?? '';
      return !block || DOOR_RE.test(block) || guessFurniture(block).type === 'box';
    })
    .map((a) => ({ p: { x: a.cx * k, z: -a.cy * k }, r: a.r * k, block: a.block ?? '', layer: a.layer }));

  const top = clusters
    .map((c) => ({ c, len: c.reduce((s, l) => s + l.len, 0) }))
    .sort((a, b) => b.len - a.len)
    .slice(0, 8)
    .map((x) => x.c)
    .sort((a, b) => boundsOf(a).minX - boundsOf(b).minX);

  const floors = top.map((lines, index): DetectedFloor => {
    const bounds = boundsOf(lines);
    const inB = (p: Vec2, pad = 0.3) => p.x >= bounds.minX - pad && p.x <= bounds.maxX + pad && p.z >= bounds.minZ - pad && p.z <= bounds.maxZ + pad;

    const doorHints = inserts.filter((i) => inB(i.p) && (DOOR_RE.test(i.name) || DOOR_RE.test(i.layer)));
    const windowHints = inserts.filter((i) => inB(i.p) && !DOOR_RE.test(i.name)
      && (WINDOW_RE.test(i.name) || WINDOW_RE.test(i.layer) || (Math.min(i.wm, i.hm) < 0.4 && Math.max(i.wm, i.hm) >= 0.4 && Math.max(i.wm, i.hm) <= 4)));
    const doorArcs = arcs.filter((a) => inB(a.p) && a.r >= 0.5 && a.r <= 1.4);
    const otherLines = allLines.filter((l) => !layers.has(l.layer) && inB(l.a, 0.5) && inB(l.b, 0.5));

    let walls = pairWalls(lines, opts);
    const paired = walls.reduce((s, w) => s + dist(w.a, w.b), 0);
    const total = lines.reduce((s, l) => s + l.len, 0);
    if (paired < total * 0.15) {
      // Single-line drawing: treat each line as a wall centreline.
      walls = lines.filter((l) => l.len >= 0.4).map((l) => ({ id: uid('w'), a: l.a, b: l.b, thickness: 0.12 }));
    }
    // Long gaps (glass facades) are only bridged when glazing or window blocks fill them.
    const hasGlazing = (a: Vec2, b: Vec2) => windowHints.some((h) => pointSegment(h.p, a, b).d < 0.35)
      || otherLines.filter((l) => pointSegment({ x: (l.a.x + l.b.x) / 2, z: (l.a.z + l.b.z) / 2 }, a, b).d < 0.2).length >= 3;
    const merged = mergeCollinear(walls, hasGlazing);
    walls = merged.walls;
    const openings: Opening[] = merged.gaps.map((g) => classifyGap(g, doorHints, windowHints, doorArcs, otherLines));
    snapJoints(walls, openings);
    doorsAtWallEnds(walls, openings, doorArcs);
    closeGaps(walls, openings, bounds);
    walls = walls.filter((w) => dist(w.a, w.b) >= 0.12);
    const wallIds = new Set(walls.map((w) => w.id));

    const rooms: Room[] = texts
      .filter((t) => inB(t.p, 0.2) && /[a-zA-ZÀ-ž]{2}/.test(t.text) && !NOT_ROOM_RE.test(t.text.trim()) && t.text.length <= 40)
      .map((t) => ({ id: uid('r'), name: titleCase(t.text), seed: t.p, floor: guessFloor(t.text) }));

    const items = furnitureFrom(inserts.filter((i) => inB(i.p, 0)), inserts);

    const stairs = detectStairs(
      inserts.filter((i) => inB(i.p, 0) && STAIR_RE.test(i.name)),
      otherLines,
      texts.filter((t) => inB(t.p, 0.5)),
    );

    const underlay: number[] = [];
    for (const l of allLines) {
      if (!inB(l.a, 1) || !inB(l.b, 1)) continue;
      if (underlay.length >= 160_000) break;
      underlay.push(round(l.a.x), round(l.a.z), round(l.b.x), round(l.b.z));
    }

    return {
      index, bounds, walls, openings: openings.filter((o) => wallIds.has(o.wallId)),
      rooms, items, stairs, underlay,
      wallLength: walls.reduce((s, w) => s + dist(w.a, w.b), 0),
    };
  });

  return { floors, warnings };
}

// ----------------------------------------------------------- clustering

function clusterLines(lines: Line[], tol: number): number[][] {
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
export function pairWalls(lines: Line[], opts: Pick<ExtractOptions, 'minThickness' | 'maxThickness'>): Wall[] {
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

interface Gap { wall: Wall; offset: number; width: number; center: Vec2; ux: number; uz: number }

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

type Hint = CadInsert & { p: Vec2; wm: number; hm: number };

function classifyGap(
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

function lineIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r = { x: b.x - a.x, z: b.z - a.z }, s = { x: d.x - c.x, z: d.z - c.z };
  const den = r.x * s.z - r.z * s.x;
  const lr = Math.hypot(r.x, r.z), ls = Math.hypot(s.x, s.z);
  if (!lr || !ls || Math.abs(den) / (lr * ls) < Math.sin(Math.PI / 9)) return null; // need > 20°
  const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / den;
  return { x: a.x + r.x * t, z: a.z + r.z * t };
}

// ----------------------------------------------------------- furniture

type InsertM = CadInsert & { p: Vec2; wm: number; hm: number };

function furnitureFrom(candidates: InsertM[], all: InsertM[]): Item[] {
  const accepted = new Set<number>();
  const items: Item[] = [];
  for (const ins of candidates) {
    const idx = all.indexOf(ins);
    let anc = ins.parent, nested = false;
    while (anc >= 0) { if (accepted.has(anc)) { nested = true; break; } anc = all[anc].parent; }
    if (nested) continue;
    const label = `${ins.name} ${ins.layer}`;
    if (DOOR_RE.test(label) || WINDOW_RE.test(ins.name) || STAIR_RE.test(ins.name) || /flech|arrow|cutlin|north|dim|col/i.test(ins.name)) continue;
    const w = ins.wm, dd = ins.hm;
    if (Math.min(w, dd) < 0.2 || Math.max(w, dd) > 4) continue;
    if (Math.min(w, dd) < 0.3 && Math.max(w, dd) > 1) continue; // thin and long: likely a window or symbol
    const guess = guessFurniture(ins.name);
    if (w * dd > 4.5 && guess.type !== 'bed' && guess.type !== 'table') continue;
    let type = guess.type, name = prettyBlockName(ins.name, guess.type), h = guess.h, color = guess.color;
    let elevation = CATALOG.find((c) => c.type === type)?.elevation;
    if (type === 'tv' && Math.min(w, dd) > 0.2) {
      // A deep "TV" block is a TV cabinet standing on the floor.
      type = 'counter'; name = 'TV unit'; h = 0.5; color = '#b08968'; elevation = undefined;
    } else if (type === 'bed') {
      name = Math.min(w, dd) < 1.25 ? 'Single bed' : 'Double bed';
    }
    items.push({
      id: uid('i'), type, name,
      x: round(ins.p.x), z: round(ins.p.z), rot: ins.angle,
      w: round(w), d: round(dd), h, color,
      ...(elevation ? { elevation } : {}),
    });
    accepted.add(idx);
    if (items.length >= 300) break;
  }
  return items;
}

function prettyBlockName(name: string, type: string): string {
  const entry = CATALOG.find((c) => c.type === type);
  if (entry && type !== 'box') return entry.name;
  const clean = name.replace(/[_$*]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > 2 && clean.length < 28 ? titleCase(clean) : 'Furniture';
}

// -------------------------------------------------------------- stairs

function detectStairs(blocks: Hint[], lines: Line[], texts: { text: string; p: Vec2 }[]): { stair: Stair; fromAbove: boolean }[] {
  const out: { stair: Stair; fromAbove: boolean }[] = [];
  const hint = (c: Vec2) => {
    const near = texts.filter((t) => dist(t.p, c) < 4);
    const up = near.filter((t) => UP_RE.test(t.text.trim()));
    const down = near.filter((t) => DOWN_RE.test(t.text.trim()));
    return { up: up[0]?.p, down: down[0]?.p };
  };
  const make = (c: Vec2, dir: Vec2, width: number, length: number) => {
    const h = hint(c);
    let dx = dir.x, dz = dir.z;
    // Start the climb at the end nearest an "UP" label (or furthest from "DOWN").
    const label = h.up ?? h.down;
    if (label) {
      const along = (label.x - c.x) * dx + (label.z - c.z) * dz;
      const startNearLabel = !!h.up;
      if ((along > 0) === startNearLabel) { dx = -dx; dz = -dz; }
    }
    out.push({
      stair: { id: uid('s'), x: round(c.x), z: round(c.z), rot: Math.atan2(dx, dz), width: round(width), length: round(length) },
      fromAbove: !h.up && !!h.down,
    });
  };

  for (const b of blocks) {
    const long = Math.max(b.wm, b.hm), short = Math.min(b.wm, b.hm);
    if (long < 1.2 || short < 0.6) continue;
    // CAD local X axis in plan coordinates.
    const ax = { x: Math.cos(b.angle), z: -Math.sin(b.angle) };
    const dir = b.wm >= b.hm ? ax : { x: -ax.z, z: ax.x };
    make(b.p, dir, short, long);
  }

  // Treads: >= 6 parallel lines of equal length, evenly spaced 0.2–0.4 m apart.
  const cand = lines.filter((l) => l.len >= 0.6 && l.len <= 2.0);
  const used = new Set<Line>();
  for (const seed of cand) {
    if (used.has(seed)) continue;
    const group = cand.filter((l) => !used.has(l) && angDiff(l.ang, seed.ang) < 0.03 && Math.abs(l.len - seed.len) < 0.08);
    const mid = (l: Line) => ({ x: (l.a.x + l.b.x) / 2, z: (l.a.z + l.b.z) / 2 });
    const m0 = mid(seed);
    const nx = -seed.uz, nz = seed.ux;
    const aligned = group
      .map((l) => ({ l, m: mid(l) }))
      .filter(({ m }) => Math.abs((m.x - m0.x) * seed.ux + (m.z - m0.z) * seed.uz) < 0.15)
      .map((x) => ({ ...x, t: (x.m.x - m0.x) * nx + (x.m.z - m0.z) * nz }))
      .sort((a, b) => a.t - b.t);
    // Find the longest evenly spaced run.
    let best: typeof aligned = [];
    for (let i = 0; i < aligned.length; i++) {
      const run = [aligned[i]];
      for (let j = i + 1; j < aligned.length; j++) {
        const gap = aligned[j].t - run[run.length - 1].t;
        if (gap < 0.15) continue;
        if (gap > 0.45) break;
        if (run.length > 1) {
          const step = run[1].t - run[0].t;
          if (Math.abs(gap - step) > 0.04) break;
        }
        run.push(aligned[j]);
      }
      if (run.length > best.length) best = run;
    }
    if (best.length < 6) continue;
    best.forEach((x) => used.add(x.l));
    const step = (best[best.length - 1].t - best[0].t) / (best.length - 1);
    const length = best[best.length - 1].t - best[0].t + step;
    const tMid = (best[0].t + best[best.length - 1].t) / 2;
    const c = { x: m0.x + nx * tMid, z: m0.z + nz * tMid };
    if (out.some((o) => dist({ x: o.stair.x, z: o.stair.z }, c) < 1.2)) continue;
    make(c, { x: nx, z: nz }, seed.len, length);
  }
  return out;
}

// ---------------------------------------------------------- alignment

/**
 * Translation for each floor so that its walls line up with the first floor.
 * Floors in a drawing are usually laid out side by side; exterior walls stack.
 */
export function alignFloors(floors: DetectedFloor[]): Vec2[] {
  if (!floors.length) return [];
  const base = floors[0];
  const t0 = { x: -base.bounds.minX, z: -base.bounds.minZ };
  return floors.map((f, i) => {
    if (i === 0) return t0;
    const off = bestOffset(base.walls, f.walls) ?? {
      x: (base.bounds.minX + base.bounds.maxX) / 2 - (f.bounds.minX + f.bounds.maxX) / 2,
      z: (base.bounds.minZ + base.bounds.maxZ) / 2 - (f.bounds.minZ + f.bounds.maxZ) / 2,
    };
    return { x: off.x + t0.x, z: off.z + t0.z };
  });
}

function bestOffset(base: Wall[], other: Wall[]): Vec2 | null {
  const axis = (ws: Wall[], vertical: boolean) => ws
    .filter((w) => {
      const dx = Math.abs(w.b.x - w.a.x), dz = Math.abs(w.b.z - w.a.z);
      return vertical ? dz > 6 * dx : dx > 6 * dz;
    })
    .sort((a, b) => dist(b.a, b.b) - dist(a.a, a.b))
    .slice(0, 14);
  const bv = axis(base, true), ov = axis(other, true), bh = axis(base, false), oh = axis(other, false);
  if (!bv.length || !ov.length || !bh.length || !oh.length) return null;
  const xs = uniq(bv.flatMap((b) => ov.map((o) => (b.a.x + b.b.x) / 2 - (o.a.x + o.b.x) / 2)));
  const zs = uniq(bh.flatMap((b) => oh.map((o) => (b.a.z + b.b.z) / 2 - (o.a.z + o.b.z) / 2)));
  const baseLong = base.filter((w) => dist(w.a, w.b) > 0.8);
  const otherLong = other.filter((w) => dist(w.a, w.b) > 0.8);
  let best: Vec2 | null = null, bestScore = 0;
  for (const dx of xs) {
    for (const dz of zs) {
      let score = 0;
      for (const o of otherLong) {
        const a = { x: o.a.x + dx, z: o.a.z + dz }, b = { x: o.b.x + dx, z: o.b.z + dz };
        for (const w of baseLong) score += overlapLength(a, b, w.a, w.b);
      }
      if (score > bestScore) { bestScore = score; best = { x: dx, z: dz }; }
    }
  }
  return best;
}

function overlapLength(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  const len = dist(a, b);
  if (len < 1e-6) return 0;
  const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
  const lc = dist(c, d);
  if (!lc || Math.abs(((d.x - c.x) * uz - (d.z - c.z) * ux) / lc) > 0.05) return 0;
  if (Math.abs((c.x - a.x) * uz - (c.z - a.z) * ux) > 0.15) return 0;
  const t1 = (c.x - a.x) * ux + (c.z - a.z) * uz, t2 = (d.x - a.x) * ux + (d.z - a.z) * uz;
  return Math.max(0, Math.min(len, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2)));
}

const uniq = (v: number[]) => [...new Set(v.map((x) => Math.round(x * 20) / 20))];

// ---------------------------------------------------------- project build

export interface BuildOptions {
  name: string;
  /** For each detected floor: target level slot (0 = ground) or null to skip. */
  assignment: (number | null)[];
  floorHeight: number;
  includeFurniture: boolean;
  keepUnderlay: boolean;
}

export function buildProject(ex: Extraction, opts: BuildOptions): Project {
  const offsets = alignFloors(ex.floors);
  const slots = new Map<number, number>(); // slot -> floor index
  ex.floors.forEach((_f, i) => {
    const slot = opts.assignment[i];
    if (slot !== null && slot !== undefined && !slots.has(slot)) slots.set(slot, i);
  });
  if (!slots.size) throw new Error('Choose at least one floor to import.');
  const ordered = [...slots.entries()].sort((a, b) => a[0] - b[0]);
  const names = ['Ground floor', 'First floor', 'Second floor', 'Third floor', 'Fourth floor', 'Fifth floor'];

  const project: Project = { version: 1, name: opts.name, levels: [], layouts: [], activeLayoutId: null, underlays: {} };
  const levelBySlot = new Map<number, Level>();
  for (const [slot, fi] of ordered) {
    const f = ex.floors[fi];
    const o = offsets[fi];
    const mv = (p: Vec2): Vec2 => ({ x: round(p.x + o.x), z: round(p.z + o.z) });
    const level: Level = {
      id: uid('L'), name: names[slot] ?? `Level ${slot}`, elevation: round(slot * opts.floorHeight),
      height: Math.min(2.7, opts.floorHeight - 0.2),
      walls: f.walls.map((w) => ({ ...w, a: mv(w.a), b: mv(w.b) })),
      openings: f.openings.map((op) => ({ ...op })),
      rooms: f.rooms.map((r) => ({ ...r, seed: mv(r.seed) })),
      items: opts.includeFurniture ? f.items.map((it) => ({ ...it, ...mv(it) })) : [],
      stairs: [],
    };
    project.levels.push(level);
    levelBySlot.set(slot, level);
    if (opts.keepUnderlay && f.underlay.length) {
      const seg = f.underlay.slice();
      for (let i = 0; i < seg.length; i += 2) { seg[i] = round(seg[i] + o.x); seg[i + 1] = round(seg[i + 1] + o.z); }
      project.underlays[level.id] = { kind: 'cad', segments: seg };
    }
  }

  // Stairs: drawn on the floor they start from, or shown as "DOWN" on the floor above.
  const slotList = ordered.map(([s]) => s);
  for (const [slot, fi] of ordered) {
    const o = offsets[fi];
    for (const { stair, fromAbove } of ex.floors[fi].stairs) {
      const isTop = slot === slotList[slotList.length - 1];
      const targetSlot = fromAbove || (isTop && slotList.length > 1) ? slotList[slotList.indexOf(slot) - 1] : slot;
      const target = targetSlot === undefined ? undefined : levelBySlot.get(targetSlot);
      if (!target) continue;
      const s = { ...stair, x: round(stair.x + o.x), z: round(stair.z + o.z) };
      if (target.stairs.some((t) => Math.hypot(t.x - s.x, t.z - s.z) < 1.2)) continue;
      target.stairs.push(s);
    }
  }

  // A pitched roof on the top floor makes the walk-through look finished; editable afterwards.
  const top = project.levels[project.levels.length - 1];
  if (top?.walls.length) top.roof = { type: 'gable', pitch: 30, overhang: 0.4, ridge: 'auto', material: 'clay' };

  // Room seeds that land inside a wall or outside the plan: nudge, else drop duplicates.
  for (const level of project.levels) {
    const seen: { area: number; c: Vec2; room: Room }[] = [];
    level.rooms = level.rooms.filter((r) => {
      let region = regionAt(level, r.seed);
      if (!region.enclosed) {
        for (const [dx, dz] of [[0, 0.4], [0, -0.4], [0.4, 0], [-0.4, 0], [0, 0.8], [0, -0.8]]) {
          const p = { x: r.seed.x + dx, z: r.seed.z + dz };
          const reg = regionAt(level, p);
          if (reg.enclosed) { r.seed = p; region = reg; break; }
        }
      }
      if (!region.enclosed) return true; // keep; the checks panel will flag it
      const same = seen.find((s) => Math.abs(s.area - region.area) < 1e-6 && dist(s.c, region.centroid) < 0.01);
      if (same) {
        // Open-plan space with several labels: keep one room named after all of them.
        if (same.room.name.split(' / ').length < 3 && !same.room.name.includes(r.name)) same.room.name += ` / ${r.name}`;
        return false;
      }
      seen.push({ area: region.area, c: region.centroid, room: r });
      return true;
    });
  }
  return project;
}

// --------------------------------------------------------------- utils

function boundsOf(lines: { a: Vec2; b: Vec2 }[]): Bounds {
  const b = emptyBounds();
  for (const l of lines) { growBounds(b, l.a.x, l.a.z); growBounds(b, l.b.x, l.b.z); }
  return b;
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
const round = (v: number) => Math.round(v * 1000) / 1000;

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase()).trim();
}

function guessFloor(name: string): Room['floor'] {
  const n = name.toLowerCase();
  if (/bath|baño|bano|wc|toilet|laund|lavand|kitchen|cocina|bad|kj[øo]kken/.test(n)) return 'tile';
  if (/terrace|terraza|patio|pergol|porch|garage|balcon|deck/.test(n)) return 'concrete';
  if (/bed|dorm|habita|sover|master|closet|vest/.test(n)) return 'carpet';
  return 'oak';
}
