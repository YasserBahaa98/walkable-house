// Plain-data representation of a parsed CAD drawing (drawing units, Y up).
// Produced in a Web Worker and consumed by the pure extraction step.

export interface CadSegment {
  x1: number; y1: number; x2: number; y2: number; layer: string;
  /** Largest dimension of the outermost block this segment came from (0 = not in a block). */
  b: number;
}

export interface CadArc { cx: number; cy: number; r: number; layer: string; block?: string; /** Swept angle in radians. */ sweep: number }

export interface CadText { text: string; x: number; y: number; layer: string; height: number }

export interface CadInsert {
  name: string;
  layer: string;
  /** World centre of the block's local bounding box. */
  cx: number;
  cy: number;
  /** Angle of the block's local X axis in world space (radians, CCW, Y up). */
  angle: number;
  /** Size of the block's local bounding box after scaling. */
  w: number;
  h: number;
  depth: number;
  /** Index of the enclosing insert in `inserts`, or -1 at the top level. */
  parent: number;
  /** Whether the block contains geometry on its own (not just nested blocks). */
  hasGeometry: boolean;
}

export interface CadLayer { name: string; count: number }

export interface CadDrawing {
  fileName: string;
  segments: CadSegment[];
  arcs: CadArc[];
  texts: CadText[];
  inserts: CadInsert[];
  layers: CadLayer[];
  /** $INSUNITS header value (0 = unitless, 1 = in, 2 = ft, 4 = mm, 5 = cm, 6 = m). */
  insunits: number;
  warnings: string[];
}
