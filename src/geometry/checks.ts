import type { Item, Level, Selection } from '../model/types';
import { type Obb, obbOverlap } from './math';
import { roomRegions } from './rooms';
import { stairObb } from './stairs';
import { endExtensions, openingSpans, wallDir, wallLength, wallObb } from './walls';

export interface Issue {
  severity: 'warning' | 'info';
  message: string;
  target: Selection;
}

export const itemObb = (i: Item): Obb => ({ cx: i.x, cz: i.z, hx: i.w / 2, hz: i.d / 2, rot: i.rot });

/** Furniture that sits on the floor and can physically collide. */
const solidItem = (i: Item) => i.type !== 'rug' && (i.elevation ?? 0) < 1.2 && i.h > 0.05;

const TOL = 0.02;
const DOOR_CLEARANCE = 0.75;

/** Design checks for one level: clashes, blocked doors, open rooms, invalid openings. */
export function checkLevel(level: Level): Issue[] {
  const issues: Issue[] = [];
  const items = level.items.filter(solidItem);
  const ext = endExtensions(level.walls);
  const wallBoxes = level.walls.map((w) => ({ w, box: wallObb(w, ext.get(w.id)) }));

  for (let i = 0; i < items.length; i++) {
    const a = items[i], ba = itemObb(a);
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      if ((a.elevation ?? 0) >= (b.elevation ?? 0) + b.h || (b.elevation ?? 0) >= (a.elevation ?? 0) + a.h) continue;
      if (obbOverlap(ba, itemObb(b)) > TOL) {
        issues.push({ severity: 'warning', message: `${a.name} overlaps ${b.name}`, target: { kind: 'item', id: a.id } });
      }
    }
    for (const { box } of wallBoxes) {
      if (obbOverlap(ba, box) > TOL) {
        issues.push({ severity: 'warning', message: `${a.name} goes through a wall`, target: { kind: 'item', id: a.id } });
        break;
      }
    }
    for (const s of level.stairs) {
      if (obbOverlap(ba, stairObb(s)) > TOL) {
        issues.push({ severity: 'warning', message: `${a.name} blocks the stairs`, target: { kind: 'item', id: a.id } });
      }
    }
  }

  for (const w of level.walls) {
    const spans = openingSpans(w, level.openings);
    const { ux, uz } = wallDir(w);
    for (const s of spans) {
      const o = s.opening;
      if (o.width > wallLength(w) + 1e-6) {
        issues.push({ severity: 'warning', message: `${label(o.kind)} is wider than its wall`, target: { kind: 'opening', id: o.id } });
      }
      if (o.kind !== 'door') continue;
      const mid = (s.from + s.to) / 2;
      const clearance: Obb = {
        cx: w.a.x + ux * mid, cz: w.a.z + uz * mid,
        hx: (s.to - s.from) / 2, hz: w.thickness / 2 + DOOR_CLEARANCE,
        rot: -Math.atan2(uz, ux),
      };
      for (const it of items) {
        if (obbOverlap(clearance, itemObb(it)) > 0.05) {
          issues.push({ severity: 'warning', message: `${it.name} blocks a door`, target: { kind: 'item', id: it.id } });
        }
      }
    }
    const all = level.openings.filter((o) => o.wallId === w.id);
    if (all.length > spans.length) {
      const lost = all.find((o) => !spans.some((s) => s.opening === o));
      if (lost) issues.push({ severity: 'warning', message: `${label(lost.kind)} overlaps another opening`, target: { kind: 'opening', id: lost.id } });
    }
  }

  const regions = roomRegions(level);
  const seen = new Map<string, string>();
  for (const r of level.rooms) {
    const reg = regions.get(r.id);
    if (!reg?.enclosed) {
      issues.push({ severity: 'warning', message: `${r.name} is not enclosed by walls`, target: { kind: 'room', id: r.id } });
      continue;
    }
    const sig = `${reg.area.toFixed(3)}:${reg.centroid.x.toFixed(2)}:${reg.centroid.z.toFixed(2)}`;
    const other = seen.get(sig);
    if (other) issues.push({ severity: 'info', message: `${r.name} shares its space with ${other}`, target: { kind: 'room', id: r.id } });
    else seen.set(sig, r.name);
  }
  return issues;
}

const label = (k: string) => (k === 'door' ? 'Door' : k === 'window' ? 'Window' : 'Opening');
