import type { FurnitureType } from './types';

export interface CatalogEntry {
  type: FurnitureType;
  name: string;
  w: number; d: number; h: number;
  color: string;
  elevation?: number;
  category: 'Living' | 'Bedroom' | 'Dining' | 'Kitchen' | 'Bath' | 'Decor';
}

export const CATALOG: CatalogEntry[] = [
  { type: 'sofa', name: 'Sofa', w: 2.1, d: 0.92, h: 0.82, color: '#7d8b84', category: 'Living' },
  { type: 'armchair', name: 'Armchair', w: 0.85, d: 0.85, h: 0.8, color: '#a4876b', category: 'Living' },
  { type: 'table', name: 'Coffee table', w: 1.1, d: 0.6, h: 0.42, color: '#a47551', category: 'Living' },
  { type: 'table', name: 'Side table', w: 0.5, d: 0.5, h: 0.55, color: '#a47551', category: 'Living' },
  { type: 'tv', name: 'TV', w: 1.4, d: 0.08, h: 0.8, color: '#1d1f22', elevation: 0.9, category: 'Living' },
  { type: 'bookshelf', name: 'Bookshelf', w: 0.9, d: 0.32, h: 1.9, color: '#c9b79c', category: 'Living' },
  { type: 'sideboard', name: 'Sideboard / TV unit', w: 1.6, d: 0.45, h: 0.6, color: '#b98b62', category: 'Living' },
  { type: 'shelving', name: 'Open shelving', w: 1.0, d: 0.38, h: 1.8, color: '#2b2d30', category: 'Living' },
  { type: 'ottoman', name: 'Ottoman / pouf', w: 0.6, d: 0.6, h: 0.42, color: '#a99a86', category: 'Living' },
  { type: 'bed', name: 'Double bed', w: 1.6, d: 2.1, h: 0.55, color: '#e7c4cf', category: 'Bedroom' },
  { type: 'bed', name: 'Single bed', w: 0.95, d: 2.05, h: 0.5, color: '#bcd0e0', category: 'Bedroom' },
  { type: 'bunkbed', name: 'Bunk bed', w: 1.0, d: 2.05, h: 1.65, color: '#bcd0e0', category: 'Bedroom' },
  { type: 'dresser', name: 'Chest of drawers', w: 0.9, d: 0.48, h: 0.95, color: '#ddd5c8', category: 'Bedroom' },
  { type: 'wardrobe', name: 'Wardrobe', w: 1.5, d: 0.6, h: 2.1, color: '#ddd5c8', category: 'Bedroom' },
  { type: 'desk', name: 'Desk', w: 1.3, d: 0.65, h: 0.75, color: '#efe9e1', category: 'Bedroom' },
  { type: 'nightstand', name: 'Nightstand', w: 0.45, d: 0.4, h: 0.52, color: '#c9b79c', category: 'Bedroom' },
  { type: 'chair', name: 'Chair', w: 0.48, d: 0.52, h: 0.88, color: '#6f655c', category: 'Dining' },
  { type: 'stool', name: 'Bar stool', w: 0.42, d: 0.42, h: 0.75, color: '#3a3532', category: 'Dining' },
  { type: 'stool', name: 'Stool', w: 0.36, d: 0.36, h: 0.46, color: '#b98b62', category: 'Dining' },
  { type: 'table', name: 'Dining table', w: 1.8, d: 0.95, h: 0.75, color: '#b98b62', category: 'Dining' },
  { type: 'counter', name: 'Kitchen counter', w: 2.4, d: 0.62, h: 0.9, color: '#e9e6e1', category: 'Kitchen' },
  { type: 'fridge', name: 'Fridge', w: 0.7, d: 0.7, h: 1.85, color: '#d8dadc', category: 'Kitchen' },
  { type: 'toilet', name: 'Toilet', w: 0.4, d: 0.68, h: 0.78, color: '#f4f4f2', category: 'Bath' },
  { type: 'bathtub', name: 'Bathtub', w: 1.7, d: 0.75, h: 0.58, color: '#f4f4f2', category: 'Bath' },
  { type: 'sink', name: 'Vanity sink', w: 0.8, d: 0.48, h: 0.85, color: '#f1eee9', category: 'Bath' },
  { type: 'rug', name: 'Rug', w: 2.0, d: 1.4, h: 0.015, color: '#b7a58f', category: 'Decor' },
  { type: 'plant', name: 'Plant', w: 0.5, d: 0.5, h: 1.2, color: '#4f7a4a', category: 'Decor' },
  { type: 'lamp', name: 'Floor lamp', w: 0.4, d: 0.4, h: 1.6, color: '#d9c7a2', category: 'Decor' },
  { type: 'art', name: 'Wall art', w: 0.9, d: 0.04, h: 0.65, color: '#c8714f', elevation: 1.35, category: 'Decor' },
  { type: 'mirror', name: 'Mirror', w: 0.6, d: 0.03, h: 0.9, color: '#b89b72', elevation: 1.0, category: 'Decor' },
  { type: 'curtain', name: 'Curtains', w: 1.8, d: 0.12, h: 2.4, color: '#e6dccb', category: 'Decor' },
  { type: 'vase', name: 'Vase with flowers', w: 0.22, d: 0.22, h: 0.45, color: '#d98f9f', elevation: 0.75, category: 'Decor' },
  { type: 'box', name: 'Labelled box', w: 0.8, d: 0.6, h: 0.8, color: '#c4bdb3', category: 'Decor' },
];

/** Guess a furniture type and default height from a free-form CAD block or label name. */
export function guessFurniture(name: string): { type: FurnitureType; h: number; color: string } {
  const n = name.toLowerCase();
  const rules: [RegExp, FurnitureType][] = [
    [/night.?stand|bedside|mesa de noche|velador/, 'nightstand'],
    [/bunk|litera|cama.?alta/, 'bunkbed'],
    [/bed|cama|seng|lit\b|hab/, 'bed'],
    [/sofa|couch|sof[aá]/, 'sofa'],
    [/arm.?chair|sill[oó]n|butaca/, 'armchair'],
    [/ottoman|pouf|puff|footstool|reposapi[eé]s/, 'ottoman'],
    [/stool|taburete|banqueta|kruk/, 'stool'],
    [/chair|silla|stol\b|chaise/, 'chair'],
    [/desk|escritorio|bureau/, 'desk'],
    [/ward|closet|armario|ropero|garderob/, 'wardrobe'],
    [/side.?board|buffet|credenza|tv.?(unit|stand|bench|cabinet)|aparador|mueble.?tv/, 'sideboard'],
    [/dresser|chest of drawers|drawers|c[oó]moda|cajonera|kommode/, 'dresser'],
    [/shelving|shelf unit|[eé]tag[eè]re|rack|estanter[ií]a/, 'shelving'],
    [/shelf|librer|estante|bookcase/, 'bookshelf'],
    [/fridge|nev|refri|frigo|kj[øo]l/, 'fridge'],
    [/counter|kitc|cocina|meseta|isla|encimera|estuf|stove|cooker|freg/, 'counter'],
    [/tv|t\.v\.|telev/, 'tv'],
    [/rug|alfombra|carpet/, 'rug'],
    [/plant|planta|maceta/, 'plant'],
    [/lamp|l[aá]mpara/, 'lamp'],
    [/wc|toilet|inodoro|retrete|sanitar/, 'toilet'],
    [/tub|ba[ñn]era|bath/, 'bathtub'],
    [/sink|lava|lavabo|vanity|washbasin/, 'sink'],
    [/curtain|cortina|drape/, 'curtain'],
    [/mirror|espejo/, 'mirror'],
    [/painting|picture|cuadro|\bart\b/, 'art'],
    [/vase|jarr[oó]n|florero/, 'vase'],
    [/table|mesa|mesita|bord|comedor|m-rec/, 'table'],
  ];
  for (const [re, type] of rules) {
    if (re.test(n)) {
      const entry = CATALOG.find((c) => c.type === type)!;
      return { type, h: entry.h, color: entry.color };
    }
  }
  return { type: 'box', h: 0.8, color: '#c4bdb3' };
}
