import DxfParser from 'dxf-parser';
import type { RawDatabase } from './cadParse';

// dxf-parser's output, typed loosely (only the fields we read).
interface DP { x: number; y: number; z?: number; bulge?: number }
interface DxfEntity {
  type: string; layer?: string;
  vertices?: DP[]; shape?: boolean; is3dPolyline?: boolean;
  center?: DP; radius?: number; startAngle?: number; endAngle?: number;
  startPoint?: DP; position?: DP; text?: string; textHeight?: number; height?: number;
  name?: string; rotation?: number; xScale?: number; yScale?: number;
  extrusionDirection?: DP;
}
interface DxfDoc {
  header?: Record<string, unknown>;
  entities?: DxfEntity[];
  blocks?: Record<string, { name: string; position?: DP; entities?: DxfEntity[] }>;
}

type RawEntity = NonNullable<RawDatabase['entities']>[number];

function mapEntity(e: DxfEntity): RawEntity | null {
  const base = { layer: e.layer, extrusionDirection: e.extrusionDirection };
  switch (e.type) {
    case 'LINE':
      if (!e.vertices || e.vertices.length < 2) return null;
      return { type: 'LINE', layer: e.layer, startPoint: e.vertices[0], endPoint: e.vertices[1] };
    case 'LWPOLYLINE':
      return { ...base, type: 'LWPOLYLINE', vertices: e.vertices ?? [], closed: !!e.shape };
    case 'POLYLINE':
      return e.is3dPolyline
        ? { type: 'POLYLINE3D', layer: e.layer, vertices: e.vertices ?? [] }
        : { ...base, type: 'POLYLINE2D', vertices: e.vertices ?? [], closed: !!e.shape };
    case 'ARC':
    case 'CIRCLE':
      return { ...base, type: e.type, center: e.center, radius: e.radius, startAngle: e.startAngle, endAngle: e.endAngle };
    case 'TEXT':
      return { ...base, type: 'TEXT', startPoint: e.startPoint ?? e.position, text: e.text, textHeight: e.textHeight };
    case 'MTEXT':
      return { type: 'MTEXT', layer: e.layer, insertionPoint: e.position, text: e.text, textHeight: e.height };
    case 'INSERT':
      return {
        ...base, type: 'INSERT', name: e.name, insertionPoint: e.position,
        // DXF stores insert rotation in degrees.
        rotation: ((e.rotation ?? 0) * Math.PI) / 180, xScale: e.xScale ?? 1, yScale: e.yScale ?? 1,
      };
    default:
      return null;
  }
}

/** Parse DXF text into the same structure LibreDWG produces for DWG files. */
export function parseDxf(text: string): RawDatabase {
  let doc: DxfDoc | null;
  try {
    doc = new DxfParser().parseSync(text) as unknown as DxfDoc | null;
  } catch (err) {
    throw new Error(`This DXF file could not be read: ${err instanceof Error ? err.message : 'invalid format'}.`, { cause: err });
  }
  if (!doc) throw new Error('This DXF file is empty.');
  const mapList = (list?: DxfEntity[]) => (list ?? []).map(mapEntity).filter((x): x is RawEntity => x !== null);
  const insunits = Number(doc.header?.$INSUNITS ?? 0);
  return {
    header: { INSUNITS: Number.isFinite(insunits) ? insunits : 0 },
    entities: mapList(doc.entities),
    tables: {
      BLOCK_RECORD: {
        entries: Object.values(doc.blocks ?? {}).map((b) => ({ name: b.name, basePoint: b.position ?? { x: 0, y: 0 }, entities: mapList(b.entities) })),
      },
    },
  };
}
