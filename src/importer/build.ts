// Floor alignment and assembling the imported floors into a project.
import type { Level, Project, Room, Vec2, Wall } from '../model/types';
import { uid } from '../model/ids';
import { dist, round3 as round } from '../geometry/math';
import { regionAt } from '../geometry/rooms';
import type { DetectedFloor, Extraction } from './extract';

// ---------------------------------------------------------- alignment

/**
 * Translation for each floor so that its walls line up with the first floor.
 * Floors in a drawing are usually laid out side by side; exterior walls stack.
 */
function alignFloors(floors: DetectedFloor[]): Vec2[] {
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

export function guessFloor(name: string): Room['floor'] {
  const n = name.toLowerCase();
  if (/bath|baño|bano|wc|toilet|laund|lavand|kitchen|cocina|bad|kj[øo]kken/.test(n)) return 'tile';
  if (/terrace|terraza|patio|pergol|porch|garage|balcon|deck/.test(n)) return 'concrete';
  if (/bed|dorm|habita|sover|master|closet|vest/.test(n)) return 'carpet';
  return 'oak';
}
