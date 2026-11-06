import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';
import { cleanText, flattenDatabase, type RawDatabase } from '../src/importer/cadParse';
import type { CadDrawing, CadSegment } from '../src/importer/cadTypes';
import { buildProject, closeGaps, extract, guessScale, guessWallLayers, lShapedStair, mergeCollinear, pairWalls } from '../src/importer/extract';
import { parseDxf } from '../src/importer/dxf';
import { roomRegions } from '../src/geometry/rooms';

const seg = (x1: number, y1: number, x2: number, y2: number, layer = 'WALL'): CadSegment => ({ x1, y1, x2, y2, layer, b: 0 });

function drawing(segments: CadSegment[], extra: Partial<CadDrawing> = {}): CadDrawing {
  const layers = new Map<string, number>();
  segments.forEach((s) => layers.set(s.layer, (layers.get(s.layer) ?? 0) + 1));
  return {
    fileName: 'test.dxf', segments, arcs: [], texts: [], inserts: [], insunits: 6, warnings: [],
    layers: [...layers].map(([name, count]) => ({ name, count })), ...extra,
  };
}

/** Double-line 5 × 4 m room with 0.2 m walls (outer face at 0, inner at 0.2). */
function roomSegments(ox = 0, gap?: [number, number]): CadSegment[] {
  const s: CadSegment[] = [];
  const W = 5, D = 4, T = 0.2;
  if (gap) {
    s.push(seg(ox, 0, ox + gap[0], 0), seg(ox + gap[1], 0, ox + W, 0));
    s.push(seg(ox + T, T, ox + gap[0], T), seg(ox + gap[1], T, ox + W - T, T));
  } else {
    s.push(seg(ox, 0, ox + W, 0), seg(ox + T, T, ox + W - T, T));
  }
  s.push(seg(ox, D, ox + W, D), seg(ox + T, D - T, ox + W - T, D - T));
  s.push(seg(ox, 0, ox, D), seg(ox + T, T, ox + T, D - T));
  s.push(seg(ox + W, 0, ox + W, D), seg(ox + W - T, T, ox + W - T, D - T));
  return s;
}

describe('cleanText', () => {
  it('strips MTEXT formatting', () => {
    expect(cleanText('{\\fArial|b1;KITCHEN}\\PArea')).toBe('KITCHEN Area');
  });
});

describe('flattenDatabase', () => {
  it('resolves nested, scaled, rotated and mirrored blocks', () => {
    const db: RawDatabase = {
      header: { INSUNITS: 4 },
      tables: { BLOCK_RECORD: { entries: [
        { name: 'UNIT', basePoint: { x: 0, y: 0 }, entities: [{ type: 'LINE', layer: '0', startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 0 } }] },
        { name: 'OUTER', basePoint: { x: 0, y: 0 }, entities: [{ type: 'INSERT', layer: '0', name: 'UNIT', insertionPoint: { x: 0, y: 0 }, rotation: Math.PI / 2, xScale: 2, yScale: 2 }] },
      ] } },
      entities: [
        { type: 'INSERT', layer: 'WALLS', name: 'OUTER', insertionPoint: { x: 10, y: 5 }, xScale: 1, yScale: 1 },
        // Mirrored OCS: x is negated (extrusion 0,0,-1)
        { type: 'INSERT', layer: 'M', name: 'UNIT', insertionPoint: { x: -3, y: 0 }, xScale: 1, yScale: 1, extrusionDirection: { x: 0, y: 0, z: -1 } },
      ],
    };
    const d = flattenDatabase(db, 'x.dwg');
    const nested = d.segments.find((s) => s.layer === 'WALLS')!;
    // UNIT rotated 90° and scaled 2: (0,0)->(0,2), then translated by (10,5); layer 0 inherits WALLS
    expect(nested.x1).toBeCloseTo(10); expect(nested.y1).toBeCloseTo(5);
    expect(nested.x2).toBeCloseTo(10); expect(nested.y2).toBeCloseTo(7);
    const mirrored = d.segments.find((s) => s.layer === 'M')!;
    expect(mirrored.x1).toBeCloseTo(3);
    expect(mirrored.x2).toBeCloseTo(2);
    expect(d.inserts.map((i) => i.name)).toEqual(['OUTER', 'UNIT', 'UNIT']);
    expect(d.insunits).toBe(4);
  });
});

describe('gap closing', () => {
  const wall = (id: string, x1: number, z1: number, x2: number, z2: number) => ({ id, a: { x: x1, z: z1 }, b: { x: x2, z: z2 }, thickness: 0.2 });
  const bounds = { minX: -0.1, minZ: -0.1, maxX: 6.1, maxZ: 4.1 };

  it('fills short gaps on the outline with solid wall', () => {
    // Top wall stops 1 m short of the left wall.
    const walls = [wall('l', 0, 0, 0, 4), wall('t', 6, 0, 1, 0), wall('r', 6, 0, 6, 4), wall('b', 0, 4, 6, 4)];
    const openings: Parameters<typeof closeGaps>[1] = [];
    closeGaps(walls, openings, bounds);
    expect(walls[1].b.x).toBeCloseTo(0);
    expect(openings).toHaveLength(0);
  });

  it('turns walkable interior gaps into passages', () => {
    const walls = [wall('l', 0, 0, 0, 4), wall('r', 6, 0, 6, 4), wall('p', 3, 4, 3, 1)]; // partition stops 1 m short
    const openings: Parameters<typeof closeGaps>[1] = [];
    closeGaps(walls, openings, { minX: -0.1, minZ: -1, maxX: 6.1, maxZ: 4.1 });
    // Nothing to hit going up (no top wall), so nothing changes.
    expect(openings).toHaveLength(0);
    walls.push(wall('t', 0, 0, 6, 0));
    closeGaps(walls, openings, { minX: -0.1, minZ: -0.1, maxX: 6.1, maxZ: 4.1 });
    expect(walls[2].b.z).toBeCloseTo(0);
    expect(openings).toHaveLength(1);
    expect(openings[0]).toMatchObject({ kind: 'opening', wallId: 'p' });
    expect(openings[0].width).toBeCloseTo(0.9);
  });
});

describe('L-shaped stair detection', () => {
  const line = (x1: number, z1: number, x2: number, z2: number) => {
    const a = { x: x1, z: z1 }, b = { x: x2, z: z2 };
    const len = Math.hypot(x2 - x1, z2 - z1);
    let ang = Math.atan2((z2 - z1) / len, (x2 - x1) / len);
    if (ang < 0) ang += Math.PI;
    if (ang >= Math.PI - 1e-9) ang -= Math.PI;
    return { a, b, len, ux: (x2 - x1) / len, uz: (z2 - z1) / len, ang, layer: 'STAIR' };
  };

  it('finds both flights, the turn and the runs from tread lines', () => {
    // Footprint 2 × 3.6 m centred at the origin. Flight 1: x ∈ [-1, 0], treads every 0.27 m climbing north (−Z).
    // Flight 2: along the top, z ∈ [-1.8, -0.8], treads vertical, climbing east (+X).
    const lines = [
      ...Array.from({ length: 10 }, (_, i) => line(-1, 1.8 - i * 0.27, 0, 1.8 - i * 0.27)),
      ...Array.from({ length: 4 }, (_, i) => line(0.1 + i * 0.27, -1.8, 0.1 + i * 0.27, -0.8)),
      line(-1, -1.8, 1, -1.8),   // outline edge (noise)
      line(0, 1.8, 0, 0.1),      // walking line (noise)
    ];
    const s = lShapedStair({ x: 0, z: 0 }, { x: 1, z: 0 }, 1, 1.8, lines)!;
    expect(s.shape).toBe('L');
    expect(s.width).toBeCloseTo(1);
    expect(s.length).toBeCloseTo(2.6);
    expect(s.length2).toBeCloseTo(1);
    expect(s.turn).toBe('right');            // walking north, the second flight goes east
    expect(Math.abs(s.rot)).toBeCloseTo(Math.PI); // climbs towards −Z
  });

  it('returns null for straight stairs', () => {
    const lines = Array.from({ length: 10 }, (_, i) => line(-0.5, 1.5 - i * 0.3, 0.5, 1.5 - i * 0.3));
    expect(lShapedStair({ x: 0, z: 0 }, { x: 1, z: 0 }, 0.5, 1.6, lines)).toBeNull();
  });
});

describe('scale detection', () => {
  it('uses wall thickness to override a wrong declared unit', () => {
    // A metre drawing (0.2 m walls) wrongly declared as inches, with appliance blocks far away.
    const far = [seg(300, 300, 300.6, 300), seg(300, 300.6, 300.6, 300.6), seg(-200, -200, -199.4, -200)].map((x) => ({ ...x, b: 0.6 }));
    const d = drawing([...roomSegments(0), ...roomSegments(12), ...far], { insunits: 1 });
    expect(guessScale(d, ['WALL'])).toBe(1);
  });
});

describe('curved CAD walls', () => {
  it('imports concentric arcs as a chain of curved wall segments', () => {
    const d = flattenDatabase({
      entities: [
        { type: 'ARC', layer: 'WALL', center: { x: 0, y: 0 }, radius: 3.1, startAngle: 0, endAngle: Math.PI / 2 },
        { type: 'ARC', layer: 'WALL', center: { x: 0, y: 0 }, radius: 2.9, startAngle: 0, endAngle: Math.PI / 2 },
      ],
    }, 'arc.dxf');
    const lines = d.segments.map((sg) => {
      const a = { x: sg.x1, z: -sg.y1 }, b = { x: sg.x2, z: -sg.y2 };
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      let ang = Math.atan2((b.z - a.z) / len, (b.x - a.x) / len);
      if (ang < 0) ang += Math.PI;
      if (ang >= Math.PI - 1e-9) ang -= Math.PI;
      return { a, b, len, ux: (b.x - a.x) / len, uz: (b.z - a.z) / len, ang, layer: sg.layer };
    });
    const walls = pairWalls(lines, { minThickness: 0.07, maxThickness: 0.6 });
    expect(walls.length).toBeGreaterThanOrEqual(6);
    walls.forEach((w) => {
      expect(w.thickness).toBeCloseTo(0.2, 1);
      // Centreline segments sit on the 3 m radius.
      const r = Math.hypot((w.a.x + w.b.x) / 2, (w.a.z + w.b.z) / 2);
      expect(r).toBeGreaterThan(2.95);
      expect(r).toBeLessThan(3.05);
    });
  });
});

describe('wall extraction', () => {
  it('pairs double lines into centreline walls with thickness', () => {
    const lines = roomSegments().map((s) => {
      const a = { x: s.x1, z: -s.y1 }, b = { x: s.x2, z: -s.y2 };
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      let ang = Math.atan2((b.z - a.z) / len, (b.x - a.x) / len);
      if (ang < 0) ang += Math.PI;
      if (ang >= Math.PI - 1e-9) ang -= Math.PI;
      return { a, b, len, ux: (b.x - a.x) / len, uz: (b.z - a.z) / len, ang, layer: 'WALL' };
    });
    const walls = pairWalls(lines, { minThickness: 0.07, maxThickness: 0.6 });
    expect(walls).toHaveLength(4);
    walls.forEach((w) => expect(w.thickness).toBeCloseTo(0.2));
  });

  it('bridges short collinear gaps as openings', () => {
    const w = (x1: number, x2: number) => ({ id: `${x1}`, a: { x: x1, z: 0 }, b: { x: x2, z: 0 }, thickness: 0.2 });
    const { walls, gaps } = mergeCollinear([w(0, 2), w(2.9, 5), w(9, 10)]);
    expect(walls).toHaveLength(2);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].width).toBeCloseTo(0.9);
    expect(gaps[0].offset).toBeCloseTo(2.45);
  });

  it('detects separate floor plans, doors and rooms, and aligns floors', () => {
    const segs = [...roomSegments(0, [1, 1.9]), ...roomSegments(20)];
    const d = drawing(segs, {
      arcs: [{ cx: 1, cy: 0.2, r: 0.9, layer: 'DOOR', sweep: Math.PI / 2 }],
      texts: [{ text: 'LIVING', x: 2.5, y: 2, layer: 'T', height: 0.2 }, { text: 'BEDROOM', x: 22.5, y: 2, layer: 'T', height: 0.2 }],
    });
    const ex = extract(d, { scale: 1, wallLayers: ['WALL'], minThickness: 0.07, maxThickness: 0.6 });
    expect(ex.floors).toHaveLength(2);
    expect(ex.floors[0].openings.filter((o) => o.kind === 'door')).toHaveLength(1);
    const p = buildProject(ex, { name: 'Test', assignment: [0, 1], floorHeight: 3, includeFurniture: true, keepUnderlay: false });
    expect(p.levels.map((l) => l.elevation)).toEqual([0, 3]);
    const [g, f] = p.levels;
    // Floors are aligned on top of each other.
    const minX = (l: typeof g) => Math.min(...l.walls.flatMap((w) => [w.a.x, w.b.x]));
    expect(minX(f)).toBeCloseTo(minX(g), 1);
    const reg = roomRegions(g).get(g.rooms[0].id)!;
    expect(g.rooms[0].name).toBe('Living');
    expect(reg.enclosed).toBe(true);
    expect(reg.area).toBeCloseTo(4.6 * 3.6, 0);
  });

  it('guesses millimetre drawings and wall layers by name', () => {
    const d = drawing(roomSegments().map((s) => ({ ...s, x1: s.x1 * 1000, y1: s.y1 * 1000, x2: s.x2 * 1000, y2: s.y2 * 1000, layer: 'A-WALL' })), { insunits: 0 });
    const layers = guessWallLayers(d);
    expect(layers).toEqual(['A-WALL']);
    expect(guessScale(d, layers)).toBe(0.001);
  });
});

describe('DXF end-to-end', () => {
  it('reads a real DXF file into a walkable project', () => {
    const text = readFileSync(new URL('./fixtures/simple-house.dxf', import.meta.url), 'utf8');
    const d = flattenDatabase(parseDxf(text), 'simple-house.dxf');
    expect(d.insunits).toBe(4);
    const wallLayers = guessWallLayers(d);
    expect(wallLayers).toContain('WALLS');
    const scale = guessScale(d, wallLayers);
    expect(scale).toBe(0.001);
    const ex = extract(d, { scale, wallLayers, minThickness: 0.07, maxThickness: 0.6 });
    expect(ex.floors).toHaveLength(1);
    const p = buildProject(ex, { name: 'Simple', assignment: [0], floorHeight: 3, includeFurniture: true, keepUnderlay: true });
    const level = p.levels[0];
    expect(level.openings.some((o) => o.kind === 'door')).toBe(true);
    expect(level.rooms.map((r) => r.name).sort()).toEqual(['Bedroom', 'Living']);
    const regions = roomRegions(level);
    for (const r of level.rooms) expect(regions.get(r.id)!.enclosed).toBe(true);
    // The mirrored bed block (OCS extrusion -Z) lands inside the bedroom.
    const bed = level.items.find((i) => i.type === 'bed')!;
    expect(bed).toBeTruthy();
    const wallMinX = Math.min(...level.walls.flatMap((w) => [w.a.x, w.b.x]));
    expect(bed.x - wallMinX).toBeGreaterThan(3.6);
    expect(bed.x - wallMinX).toBeLessThan(5.8);
    expect(p.underlays[level.id]).toBeTruthy();
  });

  it('rejects malformed DXF with a readable error', () => {
    expect(() => parseDxf('0\nSECTION\n2\nENTITIES\n0\nLINE\n10\nnot-a-number')).not.toThrow(TypeError);
  });
});

// Optional: run against a real DWG with SAMPLE_DWG=/path/to/file.dwg npm test
describe.skipIf(!process.env.SAMPLE_DWG)('DWG end-to-end (LibreDWG wasm)', () => {
  it('imports the sample DWG', async () => {
    const lib = await LibreDwg.create();
    const buf = readFileSync(process.env.SAMPLE_DWG!);
    const raw = lib.dwg_read_data(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), Dwg_File_Type.DWG);
    expect(raw).toBeTruthy();
    const d = flattenDatabase(lib.convert(raw!) as unknown as RawDatabase, 'sample.dwg');
    lib.dwg_free(raw!);
    let layers = guessWallLayers(d);
    const scale = guessScale(d, layers);
    layers = guessWallLayers(d, scale);
    const ex = extract(d, { scale, wallLayers: layers, minThickness: 0.07, maxThickness: 0.6 });
    expect(ex.floors.length).toBeGreaterThan(0);
    const p = buildProject(ex, { name: 'Sample', assignment: ex.floors.map((_, i) => i), floorHeight: 3, includeFurniture: true, keepUnderlay: true });
    expect(p.levels[0].walls.length).toBeGreaterThan(3);
  });
});
