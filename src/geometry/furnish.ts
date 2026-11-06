import { CATALOG } from '../model/catalog';
import { uid } from '../model/ids';
import type { Item, Level, Room } from '../model/types';
import { type Obb, obbOverlap, pointInObb, toWorld } from './math';
import { pointInRegion, type Region, roomRegions } from './rooms';
import { stairFootprint } from './stairs';
import { endExtensions, openingSpans, wallDir, wallLength, wallObb } from './walls';

// Automatic furnishing: pick a set of furniture for a room from its name and
// size, then place each piece where it fits, using simple interior-design
// rules (beds and sofas against walls facing into the room, a TV opposite the
// sofa, chairs tucked to tables and desks, plants in corners, nothing in front
// of doors, nothing tall in front of windows).

export type RoomKind = 'bedroom' | 'living' | 'kitchen' | 'dining' | 'bath' | 'wc' | 'study' | 'hall';

/** Guess what a room is used for from its name (any language the importer knows), falling back to its size. */
export function roomKind(name: string, area: number): RoomKind {
  const n = name.toLowerCase();
  const rules: [RegExp, RoomKind][] = [
    [/bath|shower|ensuite|en-suite|ba[ñn]o|douche/, 'bath'],
    [/\bwc\b|toilet|powder|cloak|aseo|lavabo/, 'wc'],
    [/kitchen|cocina|cuisine|k[üu]che/, 'kitchen'],
    [/dining|comedor|salle [àa] manger/, 'dining'],
    [/bed|dorm|guest|nursery|kid|habitaci[oó]n|rec[aá]mara|chambre|schlaf/, 'bedroom'],
    [/living|lounge|family|sitting|salon|sala|\btv\b|den\b|wohn/, 'living'],
    [/study|office|library|work|estudio|oficina|bureau|b[üu]ro/, 'study'],
    [/hall|landing|corridor|entr|foyer|passage|lobby|pasillo|vest[ií]bulo|recibidor|flur/, 'hall'],
  ];
  for (const [re, kind] of rules) if (re.test(n)) return kind;
  if (area < 3.5) return 'wc';
  if (area < 7) return 'study';
  if (area < 16) return 'bedroom';
  return 'living';
}

// ------------------------------------------------------------------ geometry

interface Face {
  /** Point on the room-facing surface at the wall's start, direction along it, normal into the room. */
  ox: number; oz: number; ux: number; uz: number; nx: number; nz: number; len: number;
}

interface Zone { obb: Obb; kind: 'door' | 'window' }

interface Spec { name: string; w?: number; d?: number; h?: number; elevation?: number; color?: string }

interface Ctx {
  level: Level;
  region: Region;
  faces: Face[];
  walls: Obb[];
  stairs: Obb[];
  zones: Zone[];
  doors: { x: number; z: number }[];
  items: Item[];
  rand: () => number;
  jitter: number;
  centroid: { x: number; z: number };
}

const obbOf = (i: Pick<Item, 'x' | 'z' | 'w' | 'd' | 'rot'>): Obb => ({ cx: i.x, cz: i.z, hx: i.w / 2, hz: i.d / 2, rot: i.rot });
const front = (rot: number) => ({ x: Math.sin(rot), z: Math.cos(rot) });
const right = (rot: number) => ({ x: Math.cos(rot), z: -Math.sin(rot) });
const isSoft = (i: Pick<Item, 'type'>) => i.type === 'rug' || i.type === 'curtain';
const MOUNTED: Item['type'][] = ['art', 'mirror', 'tv'];

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function context(level: Level, region: Region, keep: Item[], variant: number): Ctx {
  const ext = endExtensions(level.walls);
  const faces: Face[] = [];
  const zones: Zone[] = [];
  const doors: { x: number; z: number }[] = [];
  const inside = (x: number, z: number) => pointInRegion(region, x, z);
  for (const w of level.walls) {
    const { ux, uz, nx, nz } = wallDir(w);
    const len = wallLength(w), half = w.thickness / 2;
    // Zone boxes: local X along the wall, local Z across it.
    const rot = Math.atan2(-uz, ux);
    for (const s of [1, -1]) {
      const sx = nx * s, sz = nz * s;
      // Does this side of the wall face the room anywhere along its length?
      const probes = [0.15, 0.5, 0.85].map((f) => ({ x: w.a.x + ux * len * f + sx * (half + 0.15), z: w.a.z + uz * len * f + sz * (half + 0.15) }));
      if (probes.some((p) => inside(p.x, p.z))) {
        faces.push({ ox: w.a.x + sx * half, oz: w.a.z + sz * half, ux, uz, nx: sx, nz: sz, len });
      }
    }
    for (const span of openingSpans(w, level.openings)) {
      const o = span.opening;
      const c = (span.from + span.to) / 2;
      const cx = w.a.x + ux * c, cz = w.a.z + uz * c;
      const width = span.to - span.from;
      const depth = o.kind === 'window' ? 0.35 : 0.85;
      zones.push({ kind: o.kind === 'window' ? 'window' : 'door', obb: { cx, cz, hx: width / 2 + (o.kind === 'window' ? 0 : 0.05), hz: half + depth, rot } });
      if (o.kind !== 'window' && (inside(cx + nx * (half + 0.3), cz + nz * (half + 0.3)) || inside(cx - nx * (half + 0.3), cz - nz * (half + 0.3)))) {
        doors.push({ x: cx, z: cz });
      }
    }
  }
  return {
    level, region, faces, zones, doors,
    walls: level.walls.map((w) => wallObb(w, ext.get(w.id))),
    stairs: level.stairs.flatMap(stairFootprint),
    items: [...keep],
    rand: rng(variant * 7919 + 17),
    jitter: variant ? 1.2 : 0,
    centroid: region.centroid,
  };
}

function makeItem(spec: Spec, x: number, z: number, rot: number): Item {
  const c = CATALOG.find((e) => e.name === spec.name)!;
  const elevation = spec.elevation ?? c.elevation;
  return {
    id: uid('i'), type: c.type, name: c.name, x: r3(x), z: r3(z), rot: normRot(rot),
    w: spec.w ?? c.w, d: spec.d ?? c.d, h: spec.h ?? c.h, color: spec.color ?? c.color,
    ...(elevation ? { elevation } : {}),
  };
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
function normRot(r: number) {
  let a = r % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a <= -Math.PI) a += Math.PI * 2;
  return Math.round(a * 1e6) / 1e6;
}

/** Whether an item placed here is inside the room and clear of walls, other furniture, stairs, doors and (if tall or wall-mounted) windows. */
function fits(ctx: Ctx, it: Item): boolean {
  const o = obbOf(it);
  const pts: [number, number][] = [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]];
  for (const [sx, sz] of pts) {
    const [x, z] = toWorld(o, sx * Math.max(0, o.hx - 0.03), sz * Math.max(0, o.hz - 0.03));
    if (!pointInRegion(ctx.region, x, z)) return false;
  }
  if (ctx.walls.some((w) => obbOverlap(o, w) > 0.004)) return false;
  if (isSoft(it)) return !ctx.stairs.some((s) => obbOverlap(o, s) > 0.01);
  const e0 = it.elevation ?? 0, e1 = e0 + it.h;
  const mounted = MOUNTED.includes(it.type) && e0 > 0.3;
  for (const other of ctx.items) {
    if (isSoft(other)) continue;
    const f0 = other.elevation ?? 0, f1 = f0 + other.h;
    if (f0 >= e1 || e0 >= f1) continue;
    if (obbOverlap(o, obbOf(other)) > 0.005) return false;
  }
  if (e0 < 1.2 && ctx.stairs.some((s) => obbOverlap(o, s) > 0.005)) return false;
  for (const z of ctx.zones) {
    if (obbOverlap(o, z.obb) <= 0.005) continue;
    if (z.kind === 'door' && (e0 < 2.1 || mounted)) return false;
    if (z.kind === 'window' && (mounted || (e0 < 0.5 && e1 > 1.0))) return false;
  }
  return true;
}

interface Cand { x: number; z: number; rot: number; face?: Face }

/** Positions with the item's back against a wall, facing into the room. */
function wallCands(ctx: Ctx, w: number, d: number, gap = 0.01, step = 0.05): Cand[] {
  const out: Cand[] = [];
  for (const f of ctx.faces) {
    const rot = Math.atan2(f.nx, f.nz);
    const off = d / 2 + gap;
    for (let t = w / 2; t <= f.len - w / 2 + 1e-6; t += step) {
      out.push({ x: f.ox + f.ux * t + f.nx * off, z: f.oz + f.uz * t + f.nz * off, rot, face: f });
    }
  }
  return out;
}

/** Free floor in front of an item (metres, up to `max`). */
function frontClear(ctx: Ctx, it: Item, max = 3): number {
  const f = front(it.rot);
  const solid = ctx.items.filter((i) => !isSoft(i) && (i.elevation ?? 0) < 1.2).map(obbOf);
  for (let s = 0.1; s <= max; s += 0.1) {
    const x = it.x + f.x * (it.d / 2 + s), z = it.z + f.z * (it.d / 2 + s);
    if (!pointInRegion(ctx.region, x, z) || ctx.walls.some((w) => pointInObb(w, x, z)) || solid.some((o) => pointInObb(o, x, z, it.w / 2 - 0.1))) return s - 0.1;
  }
  return max;
}

/** Distance from the room's centre, measured along the wall (keeps pieces centred on their wall). */
function offCentre(ctx: Ctx, c: Cand): number {
  if (!c.face) return Math.hypot(c.x - ctx.centroid.x, c.z - ctx.centroid.z);
  return Math.abs((c.x - ctx.centroid.x) * c.face.ux + (c.z - ctx.centroid.z) * c.face.uz);
}

function nearDoor(ctx: Ctx, x: number, z: number, within = 1.3): number {
  let p = 0;
  for (const d of ctx.doors) p += Math.max(0, within - Math.hypot(d.x - x, d.z - z));
  return p;
}

/** How snugly an item sits in a corner (0, 1 or 2 sides blocked). */
function cornerness(ctx: Ctx, it: Item): number {
  const r = right(it.rot);
  let n = 0;
  for (const s of [-1, 1]) {
    const x = it.x + r.x * s * (it.w / 2 + 0.12), z = it.z + r.z * s * (it.w / 2 + 0.12);
    if (!pointInRegion(ctx.region, x, z) || ctx.walls.some((w) => pointInObb(w, x, z))) n++;
  }
  return n;
}

function windowBehind(ctx: Ctx, it: Item): boolean {
  const b = front(it.rot);
  const back = { cx: it.x - b.x * (it.d / 2), cz: it.z - b.z * (it.d / 2), hx: it.w / 2, hz: 0.05, rot: it.rot };
  return ctx.zones.some((z) => z.kind === 'window' && obbOverlap(back, z.obb) > 0.01);
}

/** Place the best-scoring valid candidate, or nothing. */
function place(ctx: Ctx, spec: Spec, cands: Cand[], cost: (it: Item, c: Cand) => number): Item | null {
  let best: Item | null = null, bestCost = Infinity;
  for (const c of cands) {
    const it = makeItem(spec, c.x, c.z, c.rot);
    if (!fits(ctx, it)) continue;
    const v = cost(it, c) + ctx.rand() * ctx.jitter;
    if (v < bestCost) { bestCost = v; best = it; }
  }
  if (best) ctx.items.push(best);
  return best;
}

function onWall(ctx: Ctx, spec: Spec, cost: (it: Item, c: Cand) => number = (it, c) => offCentre(ctx, c) * 0.3 + nearDoor(ctx, it.x, it.z) * 2, gap = 0.01) {
  const c = CATALOG.find((e) => e.name === spec.name)!;
  return place(ctx, spec, wallCands(ctx, spec.w ?? c.w, spec.d ?? c.d, gap), cost);
}

/** Try a list of exact positions (relative placements), first that fits wins. */
function firstFit(ctx: Ctx, spec: Spec, cands: Cand[]): Item | null {
  for (const c of cands) {
    const it = makeItem(spec, c.x, c.z, c.rot);
    if (fits(ctx, it)) { ctx.items.push(it); return it; }
  }
  return null;
}

/** Point relative to an item: `r` along its right, `f` along its front. */
function rel(it: Item, r: number, f: number) {
  const R = right(it.rot), F = front(it.rot);
  return { x: it.x + R.x * r + F.x * f, z: it.z + R.z * r + F.z * f };
}

/** Grid positions inside the room (for tables and rugs), in the room's main axes. */
function floorCands(ctx: Ctx, step = 0.1): Cand[] {
  const out: Cand[] = [];
  const axis = ctx.faces.length ? Math.atan2(ctx.faces[0].ux, ctx.faces[0].uz) : 0;
  for (const r of ctx.region.rects) {
    for (let x = r.x + step / 2; x < r.x + r.w; x += step) {
      for (let z = r.z + step / 2; z < r.z + r.d; z += step) {
        out.push({ x, z, rot: axis }, { x, z, rot: axis + Math.PI / 2 });
      }
    }
  }
  return out;
}

// --------------------------------------------------------------- recipes

function plant(ctx: Ctx) {
  onWall(ctx, { name: 'Plant' }, (it) => -cornerness(ctx, it) * 2 + nearDoor(ctx, it.x, it.z) * 3, 0.06);
}

function art(ctx: Ctx, over?: Item | null, elevation = 1.35) {
  if (over) {
    const p = rel(over, 0, -over.d / 2 + 0.025);
    if (firstFit(ctx, { name: 'Wall art', w: Math.min(1.2, over.w * 0.6), elevation }, [{ ...p, rot: over.rot }])) return;
  }
  onWall(ctx, { name: 'Wall art', elevation }, (it, c) => offCentre(ctx, c) * 0.5 - frontClear(ctx, it, 2));
}

function curtains(ctx: Ctx) {
  for (const z of ctx.zones) {
    if (z.kind !== 'window') continue;
    for (const s of [1, -1]) {
      const n = { x: Math.sin(z.obb.rot) * s, z: Math.cos(z.obb.rot) * s };
      const wallHalf = z.obb.hz - 0.35;
      const x = z.obb.cx + n.x * (wallHalf + 0.07), zz = z.obb.cz + n.z * (wallHalf + 0.07);
      if (!pointInRegion(ctx.region, x + n.x * 0.3, zz + n.z * 0.3)) continue;
      const h = Math.min(2.4, ctx.level.height - 0.1);
      const it = makeItem({ name: 'Curtains', w: z.obb.hx * 2 + 0.5, h }, x, zz, Math.atan2(n.x, n.z));
      if (fits(ctx, it)) ctx.items.push(it);
    }
  }
}

function rug(ctx: Ctx, at: { x: number; z: number }, rot: number, w: number, d: number) {
  for (let k = 0; k < 5; k++) {
    if (firstFit(ctx, { name: 'Rug', w: w - k * 0.3, d: d - k * 0.2 }, [{ ...at, rot }])) return;
  }
}

function vaseOn(ctx: Ctx, table: Item | null) {
  if (!table) return;
  ctx.items.push(makeItem({ name: 'Vase with flowers', elevation: table.h }, table.x, table.z, table.rot));
}

function diningSet(ctx: Ctx, preferAwayFrom?: Item | null): Item | null {
  for (const [w, d, per] of [[1.8, 0.95, 2], [1.4, 0.85, 2], [1.0, 0.8, 1]] as const) {
    // Reserve room for the chairs around the table while choosing its spot.
    const spot = place(ctx, { name: 'Dining table', w: w + 0.2, d: d + 1.1 }, floorCands(ctx), (it) =>
      Math.hypot(it.x - ctx.centroid.x, it.z - ctx.centroid.z) * 0.6 - (preferAwayFrom ? Math.hypot(it.x - preferAwayFrom.x, it.z - preferAwayFrom.z) * 0.4 : 0));
    if (!spot) continue;
    ctx.items.pop();
    const table = makeItem({ name: 'Dining table', w, d }, spot.x, spot.z, spot.rot);
    ctx.items.push(table);
    const chair = CATALOG.find((c) => c.name === 'Chair')!;
    const off = d / 2 + chair.d / 2 + 0.02;
    for (let k = 0; k < per; k++) {
      const r = per === 1 ? 0 : (k - (per - 1) / 2) * (w / per);
      for (const s of [-1, 1]) {
        const p = rel(table, r, s * off);
        firstFit(ctx, { name: 'Chair' }, [{ ...p, rot: table.rot + (s > 0 ? Math.PI : 0) }]);
      }
    }
    return table;
  }
  return null;
}

function bedroom(ctx: Ctx, area: number) {
  const double = area >= 9;
  const spec: Spec = { name: double ? 'Double bed' : 'Single bed' };
  const bed = onWall(ctx, spec, (it, c) => offCentre(ctx, c) * 0.4 - Math.min(frontClear(ctx, it), 1.2) * 2
    + nearDoor(ctx, it.x, it.z, 1.8) * 1.5 + (windowBehind(ctx, it) ? 0.8 : 0))
    ?? onWall(ctx, { name: 'Single bed' });
  if (bed) {
    for (const s of [-1, 1]) {
      const ns = CATALOG.find((c) => c.name === 'Nightstand')!;
      const p = rel(bed, s * (bed.w / 2 + ns.w / 2 + 0.04), -bed.d / 2 + ns.d / 2 + 0.01);
      firstFit(ctx, { name: 'Nightstand' }, [{ ...p, rot: bed.rot }]);
    }
    art(ctx, bed, 1.25);
    rug(ctx, rel(bed, 0, bed.d * 0.2), bed.rot, bed.w + 0.9, 1.6);
  }
  onWall(ctx, { name: 'Wardrobe' }, (it, c) => offCentre(ctx, c) * 0.1 - Math.min(frontClear(ctx, it), 1) * 2 + nearDoor(ctx, it.x, it.z, 1.0) * 2 - cornerness(ctx, it) * 0.3);
  if (area >= 12) deskSet(ctx);
  plant(ctx);
  if (area >= 14) onWall(ctx, { name: 'Floor lamp' }, (it) => -cornerness(ctx, it) + nearDoor(ctx, it.x, it.z) * 2, 0.08);
  curtains(ctx);
}

function deskSet(ctx: Ctx) {
  const desk = onWall(ctx, { name: 'Desk', w: 1.2 }, (it, c) => offCentre(ctx, c) * 0.2 - Math.min(frontClear(ctx, it), 1.1) * 2
    + nearDoor(ctx, it.x, it.z) * 2 - (windowBehind(ctx, it) ? 0.6 : 0));
  if (!desk) return null;
  const chair = CATALOG.find((c) => c.name === 'Chair')!;
  for (const f of [desk.d / 2 + chair.d / 2 + 0.02, desk.d / 2 + chair.d / 2 + 0.15]) {
    const p = rel(desk, 0, f);
    if (firstFit(ctx, { name: 'Chair' }, [{ ...p, rot: desk.rot + Math.PI }])) break;
  }
  return desk;
}

function living(ctx: Ctx) {
  let sofa: Item | null = null;
  for (const w of [2.1, 1.7]) {
    sofa = onWall(ctx, { name: 'Sofa', w }, (it, c) => {
      // Best with a wall at TV distance straight ahead.
      const ahead = frontClear(ctx, it, 5);
      return offCentre(ctx, c) * 0.4 + (ahead < 2.2 ? (2.2 - ahead) * 3 : ahead > 4.6 ? 2 : 0)
        + nearDoor(ctx, it.x, it.z, 1.6) * 2 + (windowBehind(ctx, it) ? 0.5 : 0);
    });
    if (sofa) break;
  }
  let table: Item | null = null;
  if (sofa) {
    const tableSpec = CATALOG.find((c) => c.name === 'Coffee table')!;
    for (const gap of [0.45, 0.38, 0.55]) {
      const p = rel(sofa, 0, sofa.d / 2 + gap + tableSpec.d / 2);
      table = firstFit(ctx, { name: 'Coffee table' }, [{ ...p, rot: sofa.rot }]);
      if (table) break;
    }
    const s = sofa;
    // TV on the wall the sofa looks at.
    onWall(ctx, { name: 'TV', elevation: 0.55, h: 0.75 }, (it) => {
      const dx = it.x - s.x, dz = it.z - s.z, f = front(s.rot);
      const along = dx * f.x + dz * f.z, side = Math.abs(dx * f.z - dz * f.x);
      return along < 1.8 || along > 5.2 || side > 1.2 ? Infinity : Math.abs(along - 2.8) * 0.5 + side * 2;
    }, 0.01);
    const centre = table ?? makeItem({ name: 'Coffee table' }, rel(s, 0, 1.2).x, rel(s, 0, 1.2).z, s.rot);
    rug(ctx, rel(s, 0, s.d / 2 + 0.85), s.rot, 2.0, 1.4);
    // Armchair at the end of the coffee table, turned towards it.
    for (const side of [1, -1]) {
      const p = rel(centre, side * (centre.w / 2 + 0.75), 0.15);
      const rot = Math.atan2(centre.x - p.x, centre.z - p.z);
      if (firstFit(ctx, { name: 'Armchair' }, [{ ...p, rot }, { ...rel(centre, side * (centre.w / 2 + 0.85), 0.3), rot }])) break;
    }
    for (const side of [1, -1]) {
      const p = rel(s, side * (s.w / 2 + 0.28), -s.d / 2 + 0.25);
      if (firstFit(ctx, { name: 'Floor lamp' }, [{ ...p, rot: s.rot }])) break;
    }
    art(ctx, s, 1.3);
  }
  onWall(ctx, { name: 'Bookshelf' }, (it, c) => offCentre(ctx, c) * 0.05 - Math.min(frontClear(ctx, it), 1) * 2 + nearDoor(ctx, it.x, it.z) * 2);
  plant(ctx);
  curtains(ctx);
  vaseOn(ctx, table);
}

function kitchen(ctx: Ctx, area: number) {
  let counter: Item | null = null;
  for (const w of [3.0, 2.6, 2.2, 1.8, 1.4]) {
    counter = onWall(ctx, { name: 'Kitchen counter', w }, (it, c) => offCentre(ctx, c) * 0.2 - Math.min(frontClear(ctx, it), 1.2) * 2 + nearDoor(ctx, it.x, it.z) * 2);
    if (counter) break;
  }
  if (counter) {
    const k = counter;
    onWall(ctx, { name: 'Fridge' }, (it) => {
      const ends = [rel(k, k.w / 2 + it.w / 2 + 0.02, 0), rel(k, -k.w / 2 - it.w / 2 - 0.02, 0)];
      return Math.min(...ends.map((e) => Math.hypot(e.x - it.x, e.z - it.z))) + nearDoor(ctx, it.x, it.z) * 2;
    });
  } else onWall(ctx, { name: 'Fridge' });
  if (area >= 10) vaseOn(ctx, diningSet(ctx, counter));
  plant(ctx);
}

function dining(ctx: Ctx) {
  const table = diningSet(ctx);
  vaseOn(ctx, table);
  art(ctx);
  plant(ctx);
  curtains(ctx);
}

function bath(ctx: Ctx, area: number) {
  if (area >= 4.2) {
    for (const w of [1.7, 1.5]) {
      if (onWall(ctx, { name: 'Bathtub', w }, (it) => -cornerness(ctx, it) * 2 + nearDoor(ctx, it.x, it.z, 1.6) * 2)) break;
    }
  }
  onWall(ctx, { name: 'Toilet' }, (it) => -cornerness(ctx, it) * 0.5 + nearDoor(ctx, it.x, it.z, 1.4) * 1.5);
  onWall(ctx, { name: 'Vanity sink', w: area >= 6 ? 0.8 : 0.6 }, (it, c) => offCentre(ctx, c) * 0.2 - Math.min(frontClear(ctx, it), 0.8) * 2);
  if (area >= 6) plant(ctx);
}

function wc(ctx: Ctx) {
  onWall(ctx, { name: 'Toilet' }, (it) => -cornerness(ctx, it) * 0.5 - Math.min(frontClear(ctx, it), 0.7) * 2 + nearDoor(ctx, it.x, it.z, 1.0));
  onWall(ctx, { name: 'Vanity sink', w: 0.6 }, (it) => -Math.min(frontClear(ctx, it), 0.7) * 2);
}

function study(ctx: Ctx, area: number) {
  deskSet(ctx);
  onWall(ctx, { name: 'Bookshelf' }, (it, c) => offCentre(ctx, c) * 0.05 - Math.min(frontClear(ctx, it), 0.9) * 2 + nearDoor(ctx, it.x, it.z) * 2);
  if (area >= 8) onWall(ctx, { name: 'Bookshelf' }, (it) => -Math.min(frontClear(ctx, it), 0.9) * 2 + nearDoor(ctx, it.x, it.z) * 2);
  if (area >= 9) {
    const chair = onWall(ctx, { name: 'Armchair' }, (it) => -cornerness(ctx, it) * 2 + nearDoor(ctx, it.x, it.z) * 2, 0.08);
    if (chair) {
      for (const side of [1, -1]) if (firstFit(ctx, { name: 'Floor lamp' }, [{ ...rel(chair, side * (chair.w / 2 + 0.25), -0.1), rot: chair.rot }])) break;
    }
  }
  plant(ctx);
  art(ctx);
  curtains(ctx);
}

function hall(ctx: Ctx, area: number) {
  if (area >= 3.5) {
    const long = ctx.region.rects.reduce((a, r) => (r.w * r.d > a.w * a.d ? r : a), ctx.region.rects[0]);
    const rot = long.w >= long.d ? Math.PI / 2 : 0;
    place(ctx, { name: 'Rug', w: Math.min(2.4, Math.max(long.w, long.d) * 0.6), d: 0.8 }, floorCands(ctx), (it) =>
      Math.hypot(it.x - ctx.centroid.x, it.z - ctx.centroid.z) + Math.abs(normRot(it.rot - rot)) * 0.5);
  }
  plant(ctx);
  art(ctx);
  if (area >= 5) onWall(ctx, { name: 'Mirror', elevation: 1.0 }, (it) => -Math.min(frontClear(ctx, it), 1.2) + nearDoor(ctx, it.x, it.z, 0.8));
}

/** Items on the level that stand inside the given room. */
export function itemsInRoom(level: Level, roomId: string): Item[] {
  const reg = roomRegions(level).get(roomId);
  if (!reg?.enclosed) return [];
  return level.items.filter((i) => pointInRegion(reg, i.x, i.z));
}

/**
 * Furniture for one room, replacing whatever stands in it now. `variant` 0 is
 * the best layout; other values give different but still valid layouts.
 * Returns null if the room is not enclosed by walls.
 */
export function furnishRoom(level: Level, room: Room, variant = 0): Item[] | null {
  const region = roomRegions(level).get(room.id);
  if (!region?.enclosed) return null;
  const inRoom = new Set(itemsInRoom(level, room.id).map((i) => i.id));
  const ctx = context(level, region, level.items.filter((i) => !inRoom.has(i.id)), variant);
  const before = ctx.items.length;
  const area = region.area;
  switch (roomKind(room.name, area)) {
    case 'bedroom': bedroom(ctx, area); break;
    case 'living': living(ctx); break;
    case 'kitchen': kitchen(ctx, area); break;
    case 'dining': dining(ctx); break;
    case 'bath': bath(ctx, area); break;
    case 'wc': wc(ctx); break;
    case 'study': study(ctx, area); break;
    case 'hall': hall(ctx, area); break;
  }
  return ctx.items.slice(before);
}
