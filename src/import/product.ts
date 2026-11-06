import type { FurnitureType, Item } from '../model/types';
import { CATALOG, guessFurniture } from '../model/catalog';
import {
  isFinish, isPartName, styleKeys, TYPE_LABELS, TYPE_PARTS, validStyleValue,
  type Finish, type ItemStyle, type PartStyle, type StyleKey,
} from '../model/styles';

// "Add from product details": turns text copied from a shop page (name and
// measurements) into a furniture item, entirely in the browser, with no
// network and no cost. It also accepts a ready-made item description (JSON),
// e.g. one Claude wrote in a chat from a link or screenshot.

/** What the importer hands to the app: an item without position. */
export type ProductSpec = Omit<Item, 'id' | 'x' | 'z' | 'rot'> & {
  /** Whether the size came from the pasted text or was filled in with typical values. */
  sizeSource: 'listed' | 'estimated';
  /** Short explanation shown before adding, e.g. which sizes were estimated. */
  notes: string;
};

/** Types an imported piece can be (imported 3D models come in another way). */
export const PRODUCT_TYPES: FurnitureType[] = (Object.keys(TYPE_LABELS) as FurnitureType[]).filter((t) => t !== 'model');

const HEX = /^#[0-9a-f]{6}$/i;
const clampCm = (v: unknown, fallback: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.round(Math.min(1200, Math.max(1, n))) / 100;
};

/** Wall-hung pieces need a height above the floor to look right. */
function elevationFor(type: FurnitureType): number | undefined {
  return type === 'tv' ? 0.9 : type === 'art' || type === 'mirror' ? 1.2 : undefined;
}

/** Style options and parts that don't apply to the type are dropped. */
export function fitToType(spec: ProductSpec, type: FurnitureType): ProductSpec {
  const out: ProductSpec = { ...spec, type };
  const keys = new Set(styleKeys(type));
  const style = Object.fromEntries(Object.entries(spec.style ?? {}).filter(([k]) => keys.has(k as StyleKey))) as ItemStyle;
  if (Object.keys(style).length) out.style = style; else delete out.style;
  const partNames = new Set(TYPE_PARTS[type] ?? []);
  const parts = Object.fromEntries(Object.entries(spec.parts ?? {}).filter(([p]) => partNames.has(p as never)));
  if (Object.keys(parts).length) out.parts = parts; else delete out.parts;
  const el = elevationFor(type);
  if (el !== undefined) out.elevation = el; else delete out.elevation;
  return out;
}

// ------------------------------------------------------------- JSON items

/**
 * Turn an item description in JSON into a safe item spec. Everything is
 * checked against the app's vocabulary; unknown values are dropped.
 */
export function specFromJson(raw: unknown): ProductSpec {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('That is not an item description.');
  const r = raw as Record<string, unknown>;
  const type: FurnitureType = PRODUCT_TYPES.includes(r.type as FurnitureType) ? (r.type as FurnitureType) : 'box';
  const spec: ProductSpec = {
    type,
    name: (typeof r.name === 'string' && r.name.trim() ? r.name.trim() : TYPE_LABELS[type]).slice(0, 80),
    w: clampCm(r.width_cm, 80), d: clampCm(r.depth_cm, 60), h: clampCm(r.height_cm, 80),
    color: typeof r.color === 'string' && HEX.test(r.color) ? r.color.toLowerCase() : '#c4bdb3',
    sizeSource: r.size_source === 'listed' ? 'listed' : 'estimated',
    notes: typeof r.notes === 'string' ? r.notes.slice(0, 400) : '',
  };
  if (isFinish(r.finish)) spec.finish = r.finish;
  if (typeof r.style === 'object' && r.style !== null) {
    const style: ItemStyle = {};
    for (const [k, v] of Object.entries(r.style as Record<string, unknown>)) {
      if (v !== null && validStyleValue(k as StyleKey, v)) (style as Record<string, unknown>)[k] = v;
    }
    spec.style = style;
  }
  // Parts may be a list ([{part, color, finish}]) or a map ({legs: {color, finish}}).
  const rawParts = Array.isArray(r.parts) ? r.parts
    : typeof r.parts === 'object' && r.parts !== null ? Object.entries(r.parts).map(([part, v]) => ({ part, ...(v as object) })) : [];
  const parts: Item['parts'] = {};
  for (const p of rawParts as Record<string, unknown>[]) {
    if (!p || !isPartName(p.part)) continue;
    const part: PartStyle = {};
    if (typeof p.color === 'string' && HEX.test(p.color)) part.color = p.color.toLowerCase();
    if (isFinish(p.finish)) part.finish = p.finish;
    if (Object.keys(part).length) parts[p.part] = part;
  }
  spec.parts = parts;
  return fitToType(spec, type);
}

// ------------------------------------------------------------ pasted text

const FRACTIONS: Record<string, string> = { '¼': '.25', '½': '.5', '¾': '.75', '⅛': '.125', '⅜': '.375', '⅝': '.625', '⅞': '.875', '⅓': '.333', '⅔': '.667' };
const NUM = String.raw`\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+`;
const UNIT = String.raw`cm|mm|m|in(?:ch(?:es)?)?|"|ft|feet|'`;

type Dim = 'w' | 'd' | 'h' | 'len' | 'dia';
const LABELS: [RegExp, Dim][] = [
  [/^(?:total |overall )?(?:width|w|ancho|anchura|breite|largeur|bredd|breedte)$/, 'w'],
  [/^(?:total |overall )?(?:depth|d|fondo|profundidad|tiefe|profondeur|djup|diepte)$/, 'd'],
  [/^(?:total |overall )?(?:height|h|alto|altura|h[öo]he|hauteur|h[öo]jd|hoogte)$/, 'h'],
  [/^(?:total |overall )?(?:length|l|largo|longitud|l[äa]nge|longueur|l[äa]ngd|lengte)$/, 'len'],
  [/^(?:diameter|diam\.?|ø|di[áa]metro|durchmesser|diam[èe]tre)$/, 'dia'],
];

function num(s: string): number {
  const [whole, frac] = s.trim().split(/\s+/);
  const part = (x: string) => (x.includes('/') ? Number(x.split('/')[0]) / Number(x.split('/')[1]) : Number(x));
  return part(whole) + (frac ? part(frac) : 0);
}

/** Centimetres per unit. */
function toCm(unit: string | undefined): number | undefined {
  if (!unit) return undefined;
  const u = unit.toLowerCase();
  if (u === 'mm') return 0.1;
  if (u === 'cm') return 1;
  if (u === 'm') return 100;
  if (u === 'ft' || u === 'feet' || u === "'") return 30.48;
  return 2.54; // inches
}

interface Found { dims: Partial<Record<Dim, number>>; lines: Set<number> }

/** Find labelled sizes ("Width: 68 cm") and size triples ("68 x 82 x 100 cm"). */
export function findMeasurements(text: string): Found {
  const lines = text.split('\n');
  const dims: Partial<Record<Dim, number>> = {};
  const used = new Set<number>();
  const unitLess: [Dim, number][] = [];
  let lastUnit: number | undefined;
  const set = (k: Dim, cmPerUnit: number | undefined, v: number) => {
    if (dims[k] !== undefined || !(v > 0)) return;
    if (cmPerUnit === undefined) unitLess.push([k, v]); else dims[k] = v * cmPerUnit;
  };
  const labelled = new RegExp(String.raw`^\s*([\p{L}ø. ]{1,24}?)\s*[:=]?\s*(${NUM})\s*(${UNIT})?(?![\p{L}\d])`, 'iu');
  const triple = new RegExp(String.raw`(?:([wdhl])\s*)?(${NUM})\s*(${UNIT})?\s*(?:([wdhl])\b)?\s*[x*]\s*(?:([wdhl])\s*)?(${NUM})\s*(${UNIT})?\s*(?:([wdhl])\b)?\s*[x*]\s*(?:([wdhl])\s*)?(${NUM})\s*(${UNIT})?\s*(?:([wdhl])\b)?`, 'i');
  lines.forEach((line, i) => {
    const t = triple.exec(line);
    if (t && dims.w === undefined && dims.d === undefined && dims.h === undefined) {
      const unit = toCm(t[11] ?? t[7] ?? t[3]);
      if (unit !== undefined) lastUnit = unit;
      const order: Dim[] = ['w', 'd', 'h'];
      [[t[1] ?? t[4], t[2]], [t[5] ?? t[8], t[6]], [t[9] ?? t[12], t[10]]].forEach(([letter, v], j) => {
        const map: Record<string, Dim> = { w: 'w', d: 'd', h: 'h', l: 'len' };
        set(letter ? map[letter.toLowerCase()] : order[j], unit, num(v));
      });
      used.add(i);
      return;
    }
    const m = labelled.exec(line);
    if (m) {
      const label = m[1].trim().toLowerCase().replace(/\s+/g, ' ');
      const hit = LABELS.find(([re]) => re.test(label));
      if (hit) {
        const u = toCm(m[3]);
        if (u !== undefined) lastUnit = u;
        set(hit[1], u, num(m[2]));
        used.add(i);
      }
    }
  });
  // Sizes written without a unit use the unit the text uses elsewhere (centimetres by default).
  for (const [k, v] of unitLess) if (dims[k] === undefined) dims[k] = v * (lastUnit ?? 1);
  return { dims, lines: used };
}

const COLOURS: [RegExp, string][] = [
  [/light beige/, '#d9cbb3'], [/dark beige/, '#a8977c'], [/beige|sand|taupe/, '#cdbb9c'],
  [/off.?white|cream|ivory|natural white/, '#ece3cf'], [/white/, '#f1efea'],
  [/black.?brown/, '#3a2e28'], [/black/, '#262626'], [/anthracite|charcoal/, '#3b3d40'],
  [/dark gr[ae]y/, '#4a4c4f'], [/light gr[ae]y/, '#b9bbbd'], [/gr[ae]y/, '#8a8c8f'],
  [/walnut/, '#6b4a35'], [/oak/, '#c49a6c'], [/birch/, '#d9b98c'], [/pine/, '#d8b47f'], [/ash\b/, '#d2b98f'],
  [/bamboo/, '#c9a86a'], [/rattan|wicker/, '#b8935f'], [/teak/, '#a8743f'],
  [/terracotta|rust/, '#b5653f'], [/dark brown/, '#4e3a2d'], [/brown/, '#7a5a43'],
  [/dark green/, '#3c5442'], [/green|olive/, '#5f7a5b'], [/dark blue|navy/, '#2f3e5a'], [/blue/, '#4f6a8a'],
  [/red/, '#a94438'], [/pink|rose/, '#d9a3a8'], [/yellow|mustard/, '#d8b74a'], [/orange/, '#c87a3d'],
  [/gold|brass/, '#b8954a'], [/silver|chrome|stainless/, '#b7b9bb'],
];
const MATERIALS: [RegExp, Finish][] = [
  [/velvet/, 'velvet'], [/leather/, 'leather'], [/glass/, 'glass'], [/marble|stone|concrete|terrazzo|granite/, 'stone'],
  [/steel|metal|alumini?um|iron|brass|chrome/, 'metal'], [/plastic|polypropylene|acrylic/, 'plastic'],
  [/fabric|cotton|linen|wool|polyester|upholster|knisa|boucl/, 'fabric'], [/lacquer|painted|stained/, 'painted'],
  [/veneer|wood|oak|birch|pine|walnut|ash\b|bamboo|beech|teak|rattan/, 'wood'],
];

const UPHOLSTERED = new Set<FurnitureType>(['sofa', 'armchair', 'ottoman', 'bed', 'bunkbed', 'curtain']);

/** Colour and finish from words like "birch veneer/Knisa light beige". */
function colourAndFinish(text: string, type: FurnitureType): { color?: string; finish?: Finish } {
  // Shops often write "frame/cover"; for upholstered pieces the cover is what you see most.
  const segs = text.toLowerCase().split(/[/,]/).map((s) => s.trim()).filter(Boolean);
  if (UPHOLSTERED.has(type)) segs.reverse();
  for (const seg of segs) {
    const color = COLOURS.find(([re]) => re.test(seg))?.[1];
    if (color) return { color, finish: MATERIALS.find(([re]) => re.test(seg))?.[1] };
  }
  const finish = MATERIALS.find(([re]) => re.test(text.toLowerCase()))?.[1];
  return finish ? { finish } : {};
}

const JUNK = /[£$€¥₹]|\breviews?\b|\bratings?\b|add to (cart|bag|basket)|\bin stock\b|article number|^\d+([.,]\d+)?$/i;

/** Read a product's name and measurements from text copied off a shop page. */
export function specFromText(input: string): ProductSpec {
  const text = input
    .replace(/[¼½¾⅛⅜⅝⅞⅓⅔]/g, (f) => FRACTIONS[f])
    .replace(/(\d)\s+\.(\d)/g, '$1.$2')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[″”“]/g, '"').replace(/[′’]/g, "'")
    .replace(/×/g, 'x')
    .replace(/\r/g, '');
  const { dims, lines: sizeLines } = findMeasurements(text);
  const descLines = text.split('\n').map((l, i) => ({ l: l.trim(), i }))
    .filter(({ l, i }) => l && !sizeLines.has(i) && !JUNK.test(l) && !/^[\p{L} ]+:/u.test(l)).map(({ l }) => l);
  if (!descLines.length && !Object.keys(dims).length) throw new Error('Paste the product name and its measurements.');

  // The type comes from the first line that names a kind of furniture.
  let type: FurnitureType = 'box';
  for (const l of descLines.slice(0, 6)) { const g = guessFurniture(l).type; if (g !== 'box') { type = g; break; } }

  // IKEA-style names put the model in capitals on its own line, then the description.
  let name = descLines[0] ?? TYPE_LABELS[type];
  if (descLines[1] && name.length <= 24 && !/\s/.test(name.trim())) name = `${name} ${descLines[1].split(',')[0]}`;
  name = name.replace(/\s+/g, ' ').slice(0, 80);

  const base = CATALOG.find((c) => c.type === type) ?? CATALOG[CATALOG.length - 1];
  const { len, dia } = dims;
  let { w, d } = dims;
  const { h } = dims;
  if (dia !== undefined) { w ??= dia; d ??= dia; }
  if (len !== undefined) {
    // A bed's length runs front to back; elsewhere length is the long side.
    if (type === 'bed' || type === 'bunkbed') d ??= len;
    else if (w === undefined) w = len;
    else d ??= len;
  }
  const missing = ([['width', w], ['depth', d], ['height', h]] as const).filter(([, v]) => v === undefined).map(([k]) => k);
  const look = colourAndFinish(descLines.slice(0, 3).join(' / '), type);
  const spec: ProductSpec = {
    type, name,
    w: clampCm(w, base.w * 100), d: clampCm(d, base.d * 100), h: clampCm(h, base.h * 100),
    color: look.color ?? base.color,
    sizeSource: missing.length ? 'estimated' : 'listed',
    notes: missing.length === 3 ? 'No measurements found, so typical sizes were used.'
      : missing.length ? `No ${missing.join(' or ')} found, so a typical value was used.` : '',
  };
  if (look.finish) spec.finish = look.finish;
  if (dia !== undefined && type === 'table') spec.style = { top: 'round' };
  return fitToType(spec, type);
}

/** Pasted text, or a JSON item description (also inside a ``` code block). */
export function parseProduct(input: string): ProductSpec {
  const t = input.trim();
  const json = /^```(?:json)?\s*([\s\S]*?)```$/.exec(t)?.[1]?.trim() ?? t;
  if (json.startsWith('{')) {
    let raw: unknown;
    try { raw = JSON.parse(json); } catch { throw new Error('That looks like an item description, but it is incomplete. Copy all of it, from { to }.'); }
    return specFromJson(raw);
  }
  return specFromText(t);
}
