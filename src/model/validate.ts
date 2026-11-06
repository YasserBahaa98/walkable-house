import { uid } from './ids';
import type { FloorMaterial, FurnitureType, Item, Level, Opening, Project, Roof, Room, Stair, Underlay, Vec2, Wall } from './types';

/**
 * Parse untrusted JSON (imported files, persisted data) into a well-formed Project.
 * Unknown fields are dropped, numbers are clamped, and dangling references removed.
 * Throws an Error with a human-readable message if the data is unusable.
 */
export function parseProject(data: unknown): Project {
  if (!isObj(data)) throw new Error('File does not contain a project.');
  if (!Array.isArray(data.levels) || data.levels.length === 0) {
    throw new Error('Project has no levels — is this a Walkable House file?');
  }
  const levels = data.levels.filter(isObj).map(parseLevel);
  if (!levels.length) throw new Error('Project levels are invalid.');
  const levelIds = new Set(levels.map((l) => l.id));

  const layouts = Array.isArray(data.layouts)
    ? data.layouts.filter(isObj).map((l) => ({
      id: str(l.id) || uid('lay'),
      name: str(l.name) || 'Layout',
      items: Object.fromEntries(
        Object.entries(isObj(l.items) ? l.items : {})
          .filter(([k, v]) => levelIds.has(k) && Array.isArray(v))
          .map(([k, v]) => [k, (v as unknown[]).filter(isObj).map(parseItem)]),
      ),
    }))
    : [];

  const underlays: Record<string, Underlay> = {};
  if (isObj(data.underlays)) {
    for (const [k, v] of Object.entries(data.underlays)) {
      if (!levelIds.has(k) || !isObj(v)) continue;
      if (v.kind === 'cad' && Array.isArray(v.segments)) {
        const segs = v.segments.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
        underlays[k] = { kind: 'cad', segments: segs.slice(0, segs.length - (segs.length % 4)) };
      } else if (v.kind === 'image' && typeof v.dataUrl === 'string' && v.dataUrl.startsWith('data:image/')) {
        underlays[k] = {
          kind: 'image', dataUrl: v.dataUrl, x: num(v.x, 0), z: num(v.z, 0),
          scale: num(v.scale, 0.01, 1e-5, 10), width: num(v.width, 1, 1), height: num(v.height, 1, 1),
        };
      }
    }
  }

  const activeLayoutId = typeof data.activeLayoutId === 'string' && layouts.some((l) => l.id === data.activeLayoutId)
    ? data.activeLayoutId : null;

  return { version: 1, name: str(data.name) || 'Untitled house', levels, layouts, activeLayoutId, underlays };
}

function parseLevel(l: Record<string, unknown>, index: number): Level {
  const walls = arr(l.walls).map(parseWall).filter((w) => dist(w.a, w.b) > 1e-3);
  const wallIds = new Set(walls.map((w) => w.id));
  const openings = arr(l.openings).map(parseOpening).filter((o) => wallIds.has(o.wallId));
  return {
    id: str(l.id) || uid('L'),
    name: str(l.name) || `Level ${index + 1}`,
    elevation: num(l.elevation, index * 3, -50, 500),
    height: num(l.height, 2.7, 1.5, 20),
    walls,
    openings,
    rooms: arr(l.rooms).map(parseRoom),
    items: arr(l.items).map(parseItem),
    stairs: arr(l.stairs).map(parseStair),
    ...(isObj(l.roof) ? { roof: parseRoof(l.roof) } : {}),
  };
}

function parseRoof(r: Record<string, unknown>): Roof {
  return {
    type: r.type === 'flat' || r.type === 'hip' ? r.type : 'gable',
    pitch: num(r.pitch, 30, 5, 70),
    overhang: num(r.overhang, 0.4, 0, 2),
    ridge: r.ridge === 'x' || r.ridge === 'z' ? r.ridge : 'auto',
    material: r.material === 'slate' || r.material === 'metal' ? r.material : 'clay',
  };
}

function parseWall(w: Record<string, unknown>): Wall {
  const out: Wall = { id: str(w.id) || uid('w'), a: vec(w.a), b: vec(w.b), thickness: num(w.thickness, 0.15, 0.02, 2) };
  if (w.height !== undefined) out.height = num(w.height, 2.7, 0.1, 20);
  if (typeof w.color === 'string' && /^#[0-9a-f]{6}$/i.test(w.color)) out.color = w.color;
  return out;
}

function parseOpening(o: Record<string, unknown>): Opening {
  const kind = o.kind === 'door' || o.kind === 'window' || o.kind === 'opening' ? o.kind : 'window';
  const out: Opening = {
    id: str(o.id) || uid('o'), wallId: str(o.wallId), kind,
    offset: num(o.offset, 0.5, 0, 1000), width: num(o.width, 0.9, 0.1, 20),
    height: num(o.height, kind === 'window' ? 1.3 : 2.1, 0.1, 20),
    sill: num(o.sill, kind === 'window' ? 0.9 : 0, 0, 20),
  };
  if (o.hinge === 'start' || o.hinge === 'end') out.hinge = o.hinge;
  if (o.swing === 'left' || o.swing === 'right') out.swing = o.swing;
  return out;
}

const FLOORS: FloorMaterial[] = ['oak', 'walnut', 'tile', 'marble', 'carpet', 'concrete'];
function parseRoom(r: Record<string, unknown>): Room {
  return {
    id: str(r.id) || uid('r'), name: str(r.name) || 'Room', seed: vec(r.seed),
    floor: FLOORS.includes(r.floor as FloorMaterial) ? (r.floor as FloorMaterial) : 'oak',
  };
}

const TYPES: FurnitureType[] = ['bed', 'sofa', 'armchair', 'table', 'chair', 'desk', 'wardrobe', 'bookshelf', 'counter',
  'fridge', 'tv', 'rug', 'plant', 'lamp', 'toilet', 'bathtub', 'sink', 'box', 'model'];
export function parseItem(i: Record<string, unknown>): Item {
  const out: Item = {
    id: str(i.id) || uid('i'),
    type: TYPES.includes(i.type as FurnitureType) ? (i.type as FurnitureType) : 'box',
    name: str(i.name) || 'Item',
    x: num(i.x, 0), z: num(i.z, 0), rot: num(i.rot, 0, -100, 100),
    w: num(i.w, 0.8, 0.01, 50), d: num(i.d, 0.6, 0.01, 50), h: num(i.h, 0.8, 0.005, 20),
    color: typeof i.color === 'string' && /^#[0-9a-f]{6}$/i.test(i.color) ? i.color : '#c4bdb3',
  };
  if (i.elevation !== undefined) out.elevation = num(i.elevation, 0, 0, 20);
  if (typeof i.modelId === 'string') out.modelId = i.modelId;
  return out;
}

function parseStair(s: Record<string, unknown>): Stair {
  const out: Stair = {
    id: str(s.id) || uid('s'), x: num(s.x, 0), z: num(s.z, 0), rot: num(s.rot, 0, -100, 100),
    width: num(s.width, 1, 0.5, 5), length: num(s.length, 3, 0.5, 15),
  };
  if (s.shape === 'L' || s.shape === 'U') {
    out.shape = s.shape;
    out.turn = s.turn === 'left' ? 'left' : 'right';
    if (s.length2 !== undefined) out.length2 = num(s.length2, out.length, 0.5, 15);
  }
  return out;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown) => (Array.isArray(v) ? v.filter(isObj) : []);
const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 200) : '');
const LIM = 100_000;
function num(v: unknown, fallback: number, min = -LIM, max = LIM): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function vec(v: unknown): Vec2 {
  return isObj(v) ? { x: num(v.x, 0), z: num(v.z, 0) } : { x: 0, z: 0 };
}
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
