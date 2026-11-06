import type { FurnitureType, Item } from './types';

// Style vocabulary for parametric furniture. The inspector, project files and
// the photo/link importer all describe a piece with these same fields, so a
// value is valid everywhere or nowhere.

export const FINISHES = ['wood', 'painted', 'fabric', 'velvet', 'leather', 'metal', 'stone', 'glass', 'plastic'] as const;
export type Finish = typeof FINISHES[number];
export const FINISH_LABELS: Record<Finish, string> = {
  wood: 'Wood', painted: 'Painted / lacquered', fabric: 'Fabric', velvet: 'Velvet', leather: 'Leather',
  metal: 'Metal', stone: 'Stone / marble', glass: 'Glass', plastic: 'Plastic',
};

export interface ItemStyle {
  /** Armrests (chairs, armchairs, sofas). */
  arms?: 'yes' | 'no';
  back?: 'solid' | 'slatted' | 'upholstered' | 'none';
  legs?: 'tapered' | 'square' | 'hairpin' | 'sled' | 'plinth';
  top?: 'rect' | 'round';
  base?: 'legs' | 'pedestal';
  doors?: number;
  drawers?: number;
  shelves?: 'open' | 'closed';
  handles?: 'bar' | 'knob' | 'none';
}
export type StyleKey = keyof ItemStyle;

/** A part of a piece that can have its own colour and finish (e.g. oak legs, grey fabric seat). */
export const PART_NAMES = ['legs', 'seat', 'top', 'fronts', 'frame'] as const;
export type PartName = typeof PART_NAMES[number];
export interface PartStyle { color?: string; finish?: Finish }
export const PART_LABELS: Record<PartName, string> = { legs: 'Legs / base', seat: 'Seat / cushions', top: 'Top', fronts: 'Doors & drawers', frame: 'Frame' };

type Choice = { kind: 'choice'; label: string; options: { id: string; label: string }[] };
type Count = { kind: 'count'; label: string; min: number; max: number };
export const STYLE_FIELDS: Record<StyleKey, Choice | Count> = {
  arms: { kind: 'choice', label: 'Arms', options: [{ id: 'yes', label: 'Arms' }, { id: 'no', label: 'No arms' }] },
  back: {
    kind: 'choice', label: 'Back',
    options: [{ id: 'solid', label: 'Solid' }, { id: 'slatted', label: 'Slatted' }, { id: 'upholstered', label: 'Upholstered' }, { id: 'none', label: 'None' }],
  },
  legs: {
    kind: 'choice', label: 'Legs',
    options: [{ id: 'tapered', label: 'Round tapered' }, { id: 'square', label: 'Square' }, { id: 'hairpin', label: 'Metal hairpin' }, { id: 'sled', label: 'Sled base' }, { id: 'plinth', label: 'Plinth' }],
  },
  top: { kind: 'choice', label: 'Top', options: [{ id: 'rect', label: 'Rectangular' }, { id: 'round', label: 'Round' }] },
  base: { kind: 'choice', label: 'Base', options: [{ id: 'legs', label: 'Four legs' }, { id: 'pedestal', label: 'Pedestal' }] },
  doors: { kind: 'count', label: 'Doors', min: 0, max: 8 },
  drawers: { kind: 'count', label: 'Drawers', min: 0, max: 12 },
  shelves: { kind: 'choice', label: 'Shelves', options: [{ id: 'closed', label: 'Closed' }, { id: 'open', label: 'Open' }] },
  handles: { kind: 'choice', label: 'Handles', options: [{ id: 'bar', label: 'Bar' }, { id: 'knob', label: 'Knob' }, { id: 'none', label: 'Push / none' }] },
};

/** Which style fields each type uses, with the default look (matches the classic built-in pieces). */
export const TYPE_STYLES: Partial<Record<FurnitureType, ItemStyle>> = {
  chair: { arms: 'no', back: 'solid', legs: 'tapered' },
  armchair: { arms: 'yes', back: 'upholstered', legs: 'tapered' },
  sofa: { arms: 'yes', back: 'upholstered', legs: 'tapered' },
  stool: { back: 'none', legs: 'tapered', top: 'round' },
  ottoman: { top: 'rect', legs: 'plinth' },
  table: { top: 'rect', base: 'legs', legs: 'tapered' },
  desk: { legs: 'square', drawers: 3, handles: 'bar' },
  bed: { legs: 'tapered' },
  bunkbed: {},
  // Counts left undefined are worked out from the size (see resolveStyle).
  wardrobe: { doors: undefined, drawers: 0, handles: 'bar' },
  sideboard: { doors: undefined, drawers: undefined, shelves: 'closed', handles: 'bar', legs: 'tapered' },
  dresser: { drawers: undefined, handles: 'knob', legs: 'tapered' },
  nightstand: { drawers: 1, shelves: 'open', handles: 'bar', legs: 'tapered' },
  bookshelf: { shelves: 'open' },
  shelving: { legs: 'square' },
};

/** Style fields that apply to a type, in inspector order. */
export function styleKeys(type: FurnitureType): StyleKey[] {
  const s = TYPE_STYLES[type];
  return s ? (Object.keys(STYLE_FIELDS) as StyleKey[]).filter((k) => k in s) : [];
}

/** Parts with their own material, per type. The item's main colour covers everything else. */
export const TYPE_PARTS: Partial<Record<FurnitureType, PartName[]>> = {
  chair: ['seat', 'legs'], armchair: ['seat', 'legs'], sofa: ['seat', 'legs'], stool: ['seat', 'legs'], ottoman: ['legs'],
  table: ['legs'], desk: ['legs'], bed: ['frame', 'legs'], bunkbed: ['frame'],
  wardrobe: ['fronts'], sideboard: ['fronts', 'top', 'legs'], dresser: ['fronts', 'top', 'legs'], nightstand: ['fronts', 'legs'],
  bookshelf: ['frame'], shelving: ['frame'], counter: ['top'],
};

/** Default main finish when the item doesn't set one ("auto" picks wood or paint from the colour). */
export const TYPE_FINISH: Partial<Record<FurnitureType, Finish>> = {
  sofa: 'fabric', armchair: 'fabric', ottoman: 'fabric', bed: 'fabric', bunkbed: 'fabric', curtain: 'fabric',
  toilet: 'painted', bathtub: 'painted', sink: 'painted', fridge: 'painted',
};

/** The item's style with the type's defaults filled in, and door/drawer counts sized to the piece. */
export function resolveStyle(it: Pick<Item, 'type' | 'style' | 'w' | 'h'>): ItemStyle {
  const st: ItemStyle = { ...TYPE_STYLES[it.type] };
  for (const [k, v] of Object.entries(it.style ?? {})) if (v !== undefined) (st as Record<string, unknown>)[k] = v;
  const { w, h } = it;
  if (it.type === 'wardrobe') st.doors ??= Math.max(1, Math.min(8, Math.round(w / 0.5)));
  if (it.type === 'sideboard') {
    st.doors ??= Math.max(1, Math.min(8, Math.round(w / 0.6)));
    st.drawers ??= Math.min(st.doors, 4);
  }
  if (it.type === 'dresser') st.drawers ??= Math.min(12, Math.max(2, Math.round((h - 0.1) / 0.22)) * (w > 1.1 ? 2 : 1));
  return st;
}

/** Does this value fit the field? (Used by validation and the importer.) */
export function validStyleValue(key: StyleKey, v: unknown): boolean {
  const f = STYLE_FIELDS[key];
  if (f.kind === 'count') return typeof v === 'number' && Number.isInteger(v) && v >= f.min && v <= f.max;
  return typeof v === 'string' && f.options.some((o) => o.id === v);
}

export const isFinish = (v: unknown): v is Finish => typeof v === 'string' && (FINISHES as readonly string[]).includes(v);
export const isPartName = (v: unknown): v is PartName => typeof v === 'string' && (PART_NAMES as readonly string[]).includes(v);

/** Display names for furniture types (the inspector's Type list and the importer). */
export const TYPE_LABELS: Record<FurnitureType, string> = {
  bed: 'Bed', bunkbed: 'Bunk bed', sofa: 'Sofa', armchair: 'Armchair', chair: 'Chair', stool: 'Stool / bar stool',
  ottoman: 'Ottoman / pouf', table: 'Table', desk: 'Desk', wardrobe: 'Wardrobe', sideboard: 'Sideboard / TV unit',
  dresser: 'Dresser / chest of drawers', nightstand: 'Nightstand', bookshelf: 'Bookshelf', shelving: 'Open shelving',
  counter: 'Kitchen counter', fridge: 'Fridge', tv: 'TV', rug: 'Rug', plant: 'Plant', lamp: 'Lamp', toilet: 'Toilet',
  bathtub: 'Bathtub', sink: 'Sink', art: 'Wall art', mirror: 'Mirror', curtain: 'Curtains', vase: 'Vase',
  box: 'Other (labelled box)', model: '3D model',
};
