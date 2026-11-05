// Domain model. Everything is in metres; the plan's X axis maps to world X and
// the plan's Y axis maps to world Z (Three.js is Y-up).

export interface Vec2 { x: number; z: number }

export interface Wall {
  id: string;
  a: Vec2;
  b: Vec2;
  thickness: number;
  /** Optional override of the level's wall height. */
  height?: number;
  color?: string;
}

export type OpeningKind = 'door' | 'window' | 'opening';

export interface Opening {
  id: string;
  wallId: string;
  kind: OpeningKind;
  /** Distance from wall.a to the opening centre, along the wall. */
  offset: number;
  width: number;
  height: number;
  /** Height of the bottom edge above the floor. 0 for doors. */
  sill: number;
  /** Door hinge side (relative to wall direction a→b) and swing side. */
  hinge?: 'start' | 'end';
  swing?: 'left' | 'right';
}

export type FloorMaterial = 'oak' | 'walnut' | 'tile' | 'marble' | 'carpet' | 'concrete';

export interface Room {
  id: string;
  name: string;
  /** Any point inside the room. The room's shape is derived from the walls. */
  seed: Vec2;
  floor: FloorMaterial;
}

export type FurnitureType =
  | 'bed' | 'sofa' | 'armchair' | 'table' | 'chair' | 'desk' | 'wardrobe' | 'bookshelf'
  | 'counter' | 'fridge' | 'tv' | 'rug' | 'plant' | 'lamp' | 'toilet' | 'bathtub' | 'sink'
  | 'box' | 'model';

export interface Item {
  id: string;
  type: FurnitureType;
  name: string;
  x: number;
  z: number;
  /** Rotation around the vertical axis in radians (Three.js convention). */
  rot: number;
  w: number;
  d: number;
  h: number;
  color: string;
  /** Height above the floor (e.g. wall-mounted TV). */
  elevation?: number;
  /** For type "model": id of an imported glTF in the asset store. */
  modelId?: string;
}

export interface Stair {
  id: string;
  /** Centre of the footprint. */
  x: number;
  z: number;
  rot: number;
  width: number;
  /** Horizontal run. The stair climbs along local +Z (from -length/2 to +length/2). */
  length: number;
}

export interface Level {
  id: string;
  name: string;
  /** Floor elevation in metres. */
  elevation: number;
  /** Default wall height. */
  height: number;
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  items: Item[];
  /** Stairs that start on this level and climb to the next one. */
  stairs: Stair[];
}

export interface CadUnderlay {
  kind: 'cad';
  /** Flat list of segments x1,z1,x2,z2 in level coordinates (metres). */
  segments: number[];
}

export interface ImageUnderlay {
  kind: 'image';
  dataUrl: string;
  /** Top-left corner position and metres per image pixel. */
  x: number;
  z: number;
  scale: number;
  width: number;
  height: number;
}

export type Underlay = CadUnderlay | ImageUnderlay;

export interface Layout {
  id: string;
  name: string;
  /** Furniture per level id. */
  items: Record<string, Item[]>;
}

export interface Project {
  version: 1;
  name: string;
  levels: Level[];
  layouts: Layout[];
  activeLayoutId: string | null;
  /** Reference drawings per level id. Not part of undo history. */
  underlays: Record<string, Underlay>;
}

export type Units = 'm' | 'cm' | 'ft';

export interface ViewSettings {
  mode: 'orbit' | 'walk';
  night: boolean;
  sun: number;            // sun azimuth in degrees
  quality: 'high' | 'low';
  cutaway: boolean;       // lower walls of the active level in orbit view
  doorsOpen: number;      // 0..1
  eye: number;            // eye height for walk mode
  showUnderlay: boolean;
  underlayOpacity: number;
  showGrid: boolean;
  snap: boolean;
  units: Units;
  ghostLevel: boolean;    // show the level below in the plan
}

export type SelectionKind = 'wall' | 'opening' | 'room' | 'item' | 'stair';
export interface Selection { kind: SelectionKind; id: string }

export type Tool = 'select' | 'wall' | 'door' | 'window' | 'room' | 'stair' | 'measure' | 'calibrate';
