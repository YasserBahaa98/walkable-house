import type { Opening, Room, Stair, Vec2, Wall, Item } from '../model/types';
import { uid } from '../model/ids';
import { type Bounds, dist, pointSegment, round3 as round } from '../geometry/math';
import type { CadDrawing } from './cadTypes';
import { boundsOf, DOOR_RE, NOT_ROOM_RE, STAIR_RE, titleCase, toPlan, WINDOW_RE } from './shared';
import { guessFurniture } from '../model/catalog';
import { classifyGap, clusterLines, closeGaps, doorsAtWallEnds, mergeCollinear, pairWalls, snapJoints } from './walls';
import { furnitureFrom } from './furniture';
import { detectStairs } from './stairs';
import { guessFloor } from './build';

// Public API of the importer.
export { guessScale, guessWallLayers, UNIT_SCALES } from './units';
export { closeGaps, mergeCollinear, pairWalls } from './walls';
export { lShapedStair } from './stairs';
export { buildProject, type BuildOptions } from './build';

// ----------------------------------------------------------------- options

export interface ExtractOptions {
  /** Metres per drawing unit. */
  scale: number;
  wallLayers: string[];
  minThickness: number;
  maxThickness: number;
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
