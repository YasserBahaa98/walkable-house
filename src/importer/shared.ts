// Helpers shared by the extraction steps. Plan coordinates are metres with Z pointing down the drawing.
import type { CadInsert, CadSegment } from './cadTypes';
import type { Vec2 } from '../model/types';
import { type Bounds, emptyBounds, growBounds } from '../geometry/math';

export const WALL_LAYER_RE = /wall|muro|mur(s|o)?\b|wand|pared|tabique|parede|v[æa]gg|mauer|^a-?wall|cloison/i;
export const DOOR_RE = /puert|door|t[üu]r\b|t[üu]re|porte|d[øo]r\b|deur|porta/i;
export const WINDOW_RE = /ventan|window|fen[eê]tre|fenster|vindu|janela|finestra/i;
export const STAIR_RE = /escal|eslca|stair|trapp|treppe|escada|scala|step/i;
export const UP_RE = /^(up|sube|subida|arriba|opp|hoch|monte|sobe)\b/i;
export const DOWN_RE = /^(down|dn|baja|bajada|abajo|ned|runter|descend|desce)\b/i;
export const NOT_ROOM_RE = /door|window|puerta|ventana|sliding|scale|escala|plan|planta|level|nivel|floor|north|norte|^\W*$|^(up|down|dn|sube|baja|n|s|e|w)$/i;

export interface Line { a: Vec2; b: Vec2; len: number; ux: number; uz: number; ang: number; layer: string }

/** A CAD segment in plan metres, with its direction folded into [0, π). */
export const toPlan = (s: CadSegment, k: number): Line => {
  const a = { x: s.x1 * k, z: -s.y1 * k }, b = { x: s.x2 * k, z: -s.y2 * k };
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
  let ang = Math.atan2(uz, ux);
  if (ang < 0) ang += Math.PI;
  if (ang >= Math.PI - 1e-9) ang -= Math.PI;
  return { a, b, len, ux, uz, ang, layer: s.layer };
};

export const angDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % Math.PI;
  return Math.min(d, Math.PI - d);
};

/** A block reference positioned in plan metres. */
export type Hint = CadInsert & { p: Vec2; wm: number; hm: number };

export function boundsOf(lines: { a: Vec2; b: Vec2 }[]): Bounds {
  const b = emptyBounds();
  for (const l of lines) { growBounds(b, l.a.x, l.a.z); growBounds(b, l.b.x, l.b.z); }
  return b;
}

/** Intersection of two infinite lines, or null if they cross at less than 20°. */
export function lineIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r = { x: b.x - a.x, z: b.z - a.z }, s = { x: d.x - c.x, z: d.z - c.z };
  const den = r.x * s.z - r.z * s.x;
  const lr = Math.hypot(r.x, r.z), ls = Math.hypot(s.x, s.z);
  if (!lr || !ls || Math.abs(den) / (lr * ls) < Math.sin(Math.PI / 9)) return null; // need > 20°
  const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / den;
  return { x: a.x + r.x * t, z: a.z + r.z * t };
}


export function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase()).trim();
}
