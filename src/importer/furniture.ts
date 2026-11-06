// Furniture from CAD block references.
import type { Item, Vec2 } from '../model/types';
import type { CadInsert } from './cadTypes';
import { CATALOG, guessFurniture } from '../model/catalog';
import { uid } from '../model/ids';
import { round3 as round } from '../geometry/math';
import { DOOR_RE, STAIR_RE, titleCase, WINDOW_RE } from './shared';

type InsertM = CadInsert & { p: Vec2; wm: number; hm: number };

export function furnitureFrom(candidates: InsertM[], all: InsertM[]): Item[] {
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