import type { CadArc, CadDrawing, CadInsert, CadSegment, CadText } from './cadTypes';

// Minimal structural view of libredwg-web's converted database. We only read
// what we need and treat everything as optional to survive odd files.
interface P { x: number; y: number; z?: number }
interface RawEnt {
  type: string; layer?: string;
  startPoint?: P; endPoint?: P; center?: P; insertionPoint?: P;
  vertices?: (P & { bulge?: number })[]; flag?: number; closed?: boolean;
  radius?: number; startAngle?: number; endAngle?: number;
  extrusionDirection?: P;
  name?: string; rotation?: number; xScale?: number; yScale?: number;
  text?: string; textHeight?: number;
}
interface RawBlock { name: string; basePoint?: P; entities?: RawEnt[] }
export interface RawDatabase {
  entities?: RawEnt[];
  tables?: { BLOCK_RECORD?: { entries?: RawBlock[] } };
  header?: { INSUNITS?: number };
}

/** 2D affine transform [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f */
type M = [number, number, number, number, number, number];
const I: M = [1, 0, 0, 1, 0, 0];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
/** Object coordinate system with extrusion (0,0,-1) mirrors X (AutoCAD arbitrary axis algorithm). */
const ocs = (e: RawEnt): M => ((e.extrusionDirection?.z ?? 1) < 0 ? [-1, 0, 0, 1, 0, 0] : I);

const MAX_DEPTH = 8;
const MAX_SEGMENTS = 400_000;

/** Strip MTEXT formatting codes (\P paragraphs, {\f...;} fonts, \A1; etc.). */
export function cleanText(s: string): string {
  return s
    .replace(/\\P/g, ' ')
    .replace(/\\[ACFHQTWfcp][^;\\{}]*;/g, '')
    .replace(/\\[LlOoKk]/g, '')
    .replace(/[{}]/g, '')
    .replace(/%%[cdp]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Flatten a converted DWG/DXF database into world-space segments, arcs, texts and
 * block references. Nested and mirrored blocks are resolved recursively.
 */
export function flattenDatabase(db: RawDatabase, fileName: string): CadDrawing {
  const blocks = new Map<string, RawBlock>();
  for (const b of db.tables?.BLOCK_RECORD?.entries ?? []) blocks.set(b.name, b);

  const segments: CadSegment[] = [];
  const arcs: CadArc[] = [];
  const texts: CadText[] = [];
  const inserts: CadInsert[] = [];
  const warnings = new Set<string>();
  const layerCount = new Map<string, number>();
  const bboxCache = new Map<string, [number, number, number, number, boolean] | null>();

  let blockExtent = 0;
  const seg = (m: M, x1: number, y1: number, x2: number, y2: number, layer: string) => {
    if (segments.length >= MAX_SEGMENTS) { warnings.add('Drawing is very large; some linework was skipped.'); return; }
    const [ax, ay] = apply(m, x1, y1), [bx, by] = apply(m, x2, y2);
    if (![ax, ay, bx, by].every(Number.isFinite)) return;
    if (Math.abs(ax - bx) + Math.abs(ay - by) < 1e-9) return;
    segments.push({ x1: ax, y1: ay, x2: bx, y2: by, layer, b: blockExtent });
    layerCount.set(layer, (layerCount.get(layer) ?? 0) + 1);
  };

  const arcPts = (cx: number, cy: number, r: number, a0: number, a1: number): [number, number][] => {
    let sweep = a1 - a0;
    while (sweep <= 0) sweep += Math.PI * 2;
    const n = Math.max(4, Math.min(48, Math.ceil(sweep / (Math.PI / 16))));
    return Array.from({ length: n + 1 }, (_, i) => {
      const a = a0 + (sweep * i) / n;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    });
  };

  /** Local bounding box of a block's geometry (recursing into nested blocks). */
  const blockBBox = (name: string, depth = 0): [number, number, number, number, boolean] | null => {
    if (bboxCache.has(name)) return bboxCache.get(name)!;
    bboxCache.set(name, null); // cycle guard
    const b = blocks.get(name);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, own = false;
    const grow = (x: number, y: number) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    };
    for (const e of b?.entities ?? []) {
      const m = ocs(e);
      const pt = (p?: P) => { if (p) { const [x, y] = apply(m, p.x, p.y); grow(x, y); own = true; } };
      if (e.type === 'LINE') { pt(e.startPoint); pt(e.endPoint); }
      else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE2D') e.vertices?.forEach(pt);
      else if ((e.type === 'ARC' || e.type === 'CIRCLE') && e.center && e.radius) {
        const [x, y] = apply(m, e.center.x, e.center.y);
        grow(x - e.radius, y - e.radius); grow(x + e.radius, y + e.radius); own = true;
      } else if (e.type === 'INSERT' && e.name && depth < MAX_DEPTH) {
        const sub = blockBBox(e.name, depth + 1);
        if (sub) {
          const t = mul(m, insertMatrix(e, blocks.get(e.name)));
          for (const [x, y] of [[sub[0], sub[1]], [sub[2], sub[1]], [sub[2], sub[3]], [sub[0], sub[3]]]) {
            const [wx, wy] = apply(t, x, y); grow(wx, wy);
          }
        }
      }
    }
    const res: [number, number, number, number, boolean] | null = minX <= maxX ? [minX, minY, maxX, maxY, own] : null;
    bboxCache.set(name, res);
    return res;
  };

  const walk = (ents: RawEnt[], m: M, parentLayer: string | null, depth: number, blockName?: string, parent = -1) => {
    for (const e of ents) {
      const layer = (e.layer === '0' || !e.layer) && parentLayer ? parentLayer : (e.layer ?? '0');
      const mm = mul(m, ocs(e));
      try {
        switch (e.type) {
          case 'LINE':
            if (e.startPoint && e.endPoint) {
              // LINE coordinates are WCS (no OCS) at the top level and block-local inside blocks.
              seg(m, e.startPoint.x, e.startPoint.y, e.endPoint.x, e.endPoint.y, layer);
            }
            break;
          case 'LWPOLYLINE':
          case 'POLYLINE2D': {
            const v = e.vertices ?? [];
            const closed = ((e.flag ?? 0) & 1) === 1 || e.closed === true;
            const n = closed ? v.length : v.length - 1;
            for (let i = 0; i < n; i++) {
              const p = v[i], q = v[(i + 1) % v.length];
              const bulge = p.bulge ?? 0;
              if (Math.abs(bulge) > 1e-6) {
                const pts = bulgePts(p, q, bulge);
                for (let k = 0; k < pts.length - 1; k++) seg(mm, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], layer);
              } else seg(mm, p.x, p.y, q.x, q.y, layer);
            }
            break;
          }
          case 'POLYLINE3D': {
            const v = e.vertices ?? [];
            for (let i = 0; i < v.length - 1; i++) seg(m, v[i].x, v[i].y, v[i + 1].x, v[i + 1].y, layer);
            break;
          }
          case 'ARC':
          case 'CIRCLE': {
            if (!e.center || !e.radius) break;
            const a0 = e.type === 'ARC' ? (e.startAngle ?? 0) : 0;
            const a1 = e.type === 'ARC' ? (e.endAngle ?? Math.PI * 2) : Math.PI * 2;
            const pts = arcPts(e.center.x, e.center.y, e.radius, a0, a1);
            for (let k = 0; k < pts.length - 1; k++) seg(mm, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], layer);
            const [cx, cy] = apply(mm, e.center.x, e.center.y);
            const scale = Math.sqrt(Math.abs(mm[0] * mm[3] - mm[1] * mm[2]));
            let sweep = a1 - a0;
            while (sweep <= 0) sweep += Math.PI * 2;
            arcs.push({ cx, cy, r: e.radius * scale, layer, block: blockName, sweep });
            break;
          }
          case 'TEXT':
          case 'MTEXT': {
            const p = e.type === 'TEXT' ? e.startPoint : e.insertionPoint;
            if (!p || !e.text) break;
            const [x, y] = apply(e.type === 'TEXT' ? mm : m, p.x, p.y);
            const text = cleanText(e.text);
            if (text) texts.push({ text, x, y, layer, height: (e.textHeight ?? 0) * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) });
            break;
          }
          case 'INSERT': {
            if (!e.name || depth >= MAX_DEPTH) break;
            const block = blocks.get(e.name);
            if (!block) { warnings.add(`Missing block definition "${e.name}".`); break; }
            const t = mul(mm, insertMatrix(e, block));
            const bb = blockBBox(e.name);
            let index = -1;
            if (bb) {
              const [lx0, ly0, lx1, ly1, own] = bb;
              const [cx, cy] = apply(t, (lx0 + lx1) / 2, (ly0 + ly1) / 2);
              const sx = Math.hypot(t[0], t[1]), sy = Math.hypot(t[2], t[3]);
              inserts.push({
                name: e.name, layer, cx, cy, angle: Math.atan2(t[1], t[0]),
                w: (lx1 - lx0) * sx, h: (ly1 - ly0) * sy, depth, parent, hasGeometry: own,
              });
              index = inserts.length - 1;
            }
            const outer = depth === 0;
            if (outer) blockExtent = bb ? Math.max((bb[2] - bb[0]) * Math.hypot(t[0], t[1]), (bb[3] - bb[1]) * Math.hypot(t[2], t[3])) : 0;
            walk(block.entities ?? [], t, layer, depth + 1, e.name, index);
            if (outer) blockExtent = 0;
            break;
          }
          default:
            break;
        }
      } catch {
        warnings.add(`Skipped a malformed ${e.type} entity.`);
      }
    }
  };

  walk(db.entities ?? [], I, null, 0);

  return {
    fileName,
    segments, arcs, texts, inserts,
    layers: [...layerCount.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    insunits: db.header?.INSUNITS ?? 0,
    warnings: [...warnings],
  };
}

function insertMatrix(e: RawEnt, block?: RawBlock): M {
  const p = e.insertionPoint ?? { x: 0, y: 0 };
  const r = e.rotation ?? 0;
  const sx = e.xScale || 1, sy = e.yScale || 1;
  const base = block?.basePoint ?? { x: 0, y: 0 };
  const c = Math.cos(r), s = Math.sin(r);
  // T(p) · R(r) · S(sx, sy) · T(-base)
  const rs: M = [c * sx, s * sx, -s * sy, c * sy, 0, 0];
  const withBase = mul(rs, [1, 0, 0, 1, -base.x, -base.y]);
  return [withBase[0], withBase[1], withBase[2], withBase[3], withBase[4] + p.x, withBase[5] + p.y];
}

function bulgePts(p: P, q: P, bulge: number): [number, number][] {
  const theta = 4 * Math.atan(bulge);
  const dx = q.x - p.x, dy = q.y - p.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-12) return [[p.x, p.y], [q.x, q.y]];
  const r = chord / (2 * Math.sin(theta / 2));
  const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
  const h = r * Math.cos(theta / 2);
  const cx = mx - (h * dy) / chord, cy = my + (h * dx) / chord;
  const a0 = Math.atan2(p.y - cy, p.x - cx);
  const n = Math.max(2, Math.min(32, Math.ceil(Math.abs(theta) / (Math.PI / 16))));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + (theta * i) / n;
    return [cx + Math.abs(r) * Math.cos(a), cy + Math.abs(r) * Math.sin(a)] as [number, number];
  });
}
