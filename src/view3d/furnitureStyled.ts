import * as THREE from 'three';
import type { FurnitureType } from '../model/types';
import type { ItemStyle } from '../model/styles';
import { fabricMaterial, metalMaterial, solid } from './materials';
import { add, autoFinish, cylinder, type Ctx, handle, legSet, material, METAL, rod, shade, v3, WHITE, WOOD } from './furnitureKit';

// Furniture whose shape follows style options (arms, backs, legs, tops,
// doors, drawers, shelves, handles) and per-part materials.

export type StyledBuilder = (g: THREE.Group, c: Ctx) => void;

const BOARD = 0.018;

// ------------------------------------------------------------------ seating

function chairBack(g: THREE.Group, c: Ctx, w: number, seatH: number, top: number, zb: number, seatMat: THREE.Material, posts: THREE.Material) {
  const backH = top - seatH;
  if (backH < 0.05 || c.st.back === 'none') return;
  if (c.st.back === 'upholstered') {
    const m = add(g, seatMat, w - 0.02, backH - 0.02, 0.07, 0, seatH + 0.01, zb + 0.01, 0.03);
    if (m) { m.rotation.x = -0.1; m.position.z -= 0.02; }
    return;
  }
  for (const sx of [-1, 1]) cylinder(g, posts, 0.014, 0.017, backH, sx * (w / 2 - 0.035), seatH, zb, 10);
  const railH = Math.min(0.2, backH * 0.45);
  if (c.st.back === 'slatted') {
    const rail = Math.min(0.06, backH * 0.2);
    add(g, c.main, w - 0.04, rail, 0.025, 0, top - rail - 0.01, zb, 0.008);
    add(g, c.main, w - 0.06, 0.03, 0.022, 0, seatH + 0.06, zb, 0.006);
    const n = Math.max(3, Math.round((w - 0.1) / 0.07));
    const span = w - 0.12, slatH = top - rail - 0.01 - (seatH + 0.09);
    for (let k = 0; k < n; k++) add(g, c.main, 0.03, slatH, 0.015, -span / 2 + (span * (k + 0.5)) / n, seatH + 0.09, zb, 0.004);
    return;
  }
  add(g, c.main, w - 0.02, railH, 0.03, 0, top - railH - 0.02, zb + 0.01, 0.012);
}

function armrests(g: THREE.Group, w: number, d: number, seatH: number, armY: number, mat: THREE.Material) {
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - 0.025);
    add(g, mat, 0.045, 0.03, d * 0.72, x, armY, -d * 0.08, 0.01);
    rod(g, mat, v3(x, seatH, d * 0.24), v3(x, armY, d * 0.24), 0.014);
  }
}

const chair: StyledBuilder = (g, c) => {
  const { w, d, h, color } = c.it;
  const upholstered = c.st.back === 'upholstered';
  const seatMat = c.part('seat', color, upholstered ? 'fabric' : c.mainFinish);
  const seatH = Math.min(0.46, h * 0.52);
  const t = upholstered ? 0.07 : 0.04;
  add(g, seatMat, w, t, d * 0.9, 0, seatH - t, 0.02, upholstered ? 0.03 : 0.012);
  const legs = c.legs();
  legSet(g, c.st.legs, w, d * 0.9, seatH - t, 0.035, legs, 0.017);
  const zb = -d * 0.45 + 0.055;
  chairBack(g, c, w, seatH, h, zb, seatMat, c.st.legs === 'hairpin' || c.st.legs === 'sled' ? metalMaterial(METAL, 0.4) : legs);
  if (c.st.arms === 'yes') armrests(g, w, d, seatH, seatH + Math.min(0.22, (h - seatH) * 0.55), c.st.legs === 'tapered' || c.st.legs === 'square' ? legs : c.main);
};

/** Sofas and armchairs: upholstered body with cushions. */
const upholstered: StyledBuilder = (g, c) => {
  const { w, d, h, color } = c.it;
  const frame = material(c.mainFinish, shade(color, 0.85));
  const cushion = c.part('seat', color, c.mainFinish);
  const legH = c.st.legs === 'plinth' ? 0.06 : 0.1;
  legSet(g, c.st.legs, w, d, legH, c.st.legs === 'plinth' ? 0.04 : 0.07, c.st.legs === 'plinth' ? solid('#2a2725', 0.9) : c.legs(), 0.022);
  const arm = c.st.arms === 'no' ? 0 : Math.min(0.2, w * 0.12);
  const baseH = h * 0.3;
  add(g, frame, w, baseH, d, 0, legH, 0, 0.05);
  const seatY = legH + baseH;
  const backD = c.st.back === 'none' ? 0 : 0.2;
  const seats = Math.max(1, Math.round((w - arm * 2) / 0.7));
  const sw = (w - arm * 2) / seats;
  for (let s = 0; s < seats; s++) add(g, cushion, sw - 0.015, h * 0.17, d - 0.04 - backD, -w / 2 + arm + sw * (s + 0.5), seatY, backD / 2 + 0.02, 0.06);
  const backH = h - seatY;
  switch (c.st.back) {
    case 'none': break;
    case 'solid':
      add(g, frame, w, backH, 0.2, 0, seatY, -d / 2 + 0.1, 0.07);
      break;
    case 'slatted': {
      const wood = c.legs();
      const zb = -d / 2 + 0.05;
      add(g, wood, w - 0.02, 0.05, 0.04, 0, h - 0.05, zb, 0.01);
      const n = Math.max(4, Math.round(w / 0.1));
      for (let k = 0; k < n; k++) add(g, wood, 0.035, backH - 0.05, 0.025, -w / 2 + 0.06 + ((w - 0.12) * k) / (n - 1), seatY, zb, 0.005);
      add(g, cushion, w - arm * 2 - 0.04, backH * 0.6, 0.1, 0, seatY + 0.05, zb + 0.08, 0.05);
      break;
    }
    default: // upholstered: back cushions leaning slightly back
      for (let s = 0; s < seats; s++) {
        const m = add(g, cushion, sw - 0.02, h * 0.48, 0.2, -w / 2 + arm + sw * (s + 0.5), seatY, -d / 2 + 0.13, 0.07);
        if (m) m.rotation.x = -0.12;
      }
      add(g, frame, w - arm * 2, h * 0.42, 0.1, 0, seatY, -d / 2 + 0.05, 0.04);
  }
  if (arm > 0) for (const sx of [-1, 1]) add(g, frame, arm, h * 0.42, d, sx * (w / 2 - arm / 2), legH + h * 0.18, 0, 0.07);
};

const stool: StyledBuilder = (g, c) => {
  const { w, d, h, color } = c.it;
  const seatMat = c.part('seat', color, c.mainFinish);
  const soft = ['fabric', 'velvet', 'leather'].includes(c.it.parts?.seat?.finish ?? c.mainFinish);
  const t = soft ? 0.07 : 0.04;
  const hasBack = c.st.back !== undefined && c.st.back !== 'none';
  const seatH = hasBack ? Math.max(0.4, h - 0.3) : h;
  if (c.st.top === 'rect') add(g, seatMat, w, t, d, 0, seatH - t, 0, soft ? 0.03 : 0.01);
  else cylinder(g, seatMat, Math.min(w, d) / 2, Math.min(w, d) / 2 - 0.01, t, 0, seatH - t, 0, 32);
  const legs = c.legs();
  const fw = w * 0.82, fd = d * 0.82, inset = 0.03;
  legSet(g, c.st.legs, fw, fd, seatH - t, inset, legs, 0.016);
  if (seatH > 0.6 && (c.st.legs === 'tapered' || c.st.legs === 'square')) {
    // Footrest ring for bar stools.
    const y = seatH * 0.36, xs = fw / 2 - inset, zs = fd / 2 - inset;
    const pts = [v3(-xs, y, -zs), v3(xs, y, -zs), v3(xs, y, zs), v3(-xs, y, zs)];
    for (let k = 0; k < 4; k++) rod(g, legs, pts[k], pts[(k + 1) % 4], 0.009);
  }
  if (hasBack) chairBack(g, c, w * 0.9, seatH, h, -d * 0.4, seatMat, legs);
};

const ottoman: StyledBuilder = (g, c) => {
  const { w, d, h } = c.it;
  const legH = c.st.legs === 'plinth' ? 0 : Math.min(0.1, h * 0.25);
  if (legH) legSet(g, c.st.legs, w, d, legH, 0.06, c.legs(), 0.018);
  if (c.st.top === 'round') {
    const r = Math.min(w, d) / 2;
    cylinder(g, c.main, r, r - 0.005, h - legH - 0.03, 0, legH, 0, 40);
    cylinder(g, c.main, r - 0.025, r, 0.03, 0, h - 0.03, 0, 40);
  } else {
    add(g, c.main, w, h - legH, d, 0, legH, 0, 0.06);
  }
};

// -------------------------------------------------------------------- beds

const bed: StyledBuilder = (g, c) => {
  const { w, d, h } = c.it;
  // Upholstered frame and headboard, mattress, duvet and pillows.
  const frame = c.part('frame', shade(c.it.color, 0.55), 'fabric');
  const legH = c.st.legs === 'plinth' ? 0 : 0.08;
  if (legH) legSet(g, c.st.legs, w, d, legH, 0.08, c.legs(), 0.025);
  add(g, frame, w, h * 0.45 - legH, d, 0, legH, 0, 0.03);
  add(g, fabricMaterial(WHITE), w - 0.06, h * 0.35, d - 0.08, 0, h * 0.45, 0.02, 0.06);
  add(g, c.main, w - 0.02, 0.07, d * 0.64, 0, h * 0.77, d * 0.17, 0.035);
  add(g, frame, w, Math.max(0.9, h * 1.8), 0.1, 0, 0, -d / 2 + 0.05, 0.04);
  const pw = w > 1.2 ? (w - 0.2) / 2 : w - 0.2;
  for (const x of w > 1.2 ? [-pw / 2 - 0.05, pw / 2 + 0.05] : [0]) add(g, fabricMaterial('#fbfaf7'), pw, 0.13, 0.4, x, h * 0.78, -d / 2 + 0.31, 0.06);
};

const bunkbed: StyledBuilder = (g, c) => {
  const { w, d, h } = c.it;
  const frame = c.part('frame', WOOD, 'wood');
  const post = 0.055;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, frame, post, h, post, sx * (w / 2 - post / 2), 0, sz * (d / 2 - post / 2), 0.006);
  const lower = 0.22, upper = Math.max(lower + 0.85, h - 0.45);
  const ladderX = w / 2 - 0.3;
  for (const [i, y] of [lower, upper].entries()) {
    // Rails and end boards carrying the mattress.
    for (const sx of [-1, 1]) add(g, frame, 0.03, 0.12, d - post * 2, sx * (w / 2 - 0.03), y - 0.12, 0);
    for (const sz of [-1, 1]) add(g, frame, w - post * 2, i ? 0.4 : 0.3, 0.025, 0, y - 0.12, sz * (d / 2 - 0.02));
    add(g, fabricMaterial(WHITE), w - 0.1, 0.14, d - 0.1, 0, y - 0.02, 0, 0.04);
    add(g, c.main, w - 0.08, 0.05, d * 0.62, 0, y + 0.11, d * 0.15, 0.025);
    add(g, fabricMaterial('#fbfaf7'), w - 0.3, 0.11, 0.36, 0, y + 0.12, -d / 2 + 0.3, 0.05);
  }
  // Guard rails on the upper bunk, open where the ladder arrives.
  for (const sx of [-1, 1]) {
    const len = sx > 0 ? d - 0.6 : d - post * 2;
    add(g, frame, 0.03, 0.05, len, sx * (w / 2 - 0.03), upper + 0.25, sx > 0 ? -(d - len) / 2 + post : 0);
  }
  // Ladder on the right-hand side near the foot.
  const lz = d / 2 - 0.35;
  for (const dz of [-0.18, 0.18]) rod(g, frame, v3(ladderX + 0.27, 0, lz + dz), v3(ladderX + 0.27, upper + 0.3, lz + dz), 0.018);
  for (let y = 0.25; y < upper + 0.1; y += 0.28) rod(g, frame, v3(ladderX + 0.27, y, lz - 0.18), v3(ladderX + 0.27, y, lz + 0.18), 0.014);
};

// ----------------------------------------------------------------- tables

const table: StyledBuilder = (g, c) => {
  const { w, d, h } = c.it;
  const t = Math.min(0.04, h * 0.1);
  const round = c.st.top === 'round';
  if (round) cylinder(g, c.main, 0.5, 0.5, t, 0, h - t, 0, 48).scale.set(w, 1, d);
  else add(g, c.main, w, t, d, 0, h - t, 0, 0.008);
  const legs = c.it.parts?.legs || c.st.legs === 'hairpin' || c.st.legs === 'sled' ? c.legs() : autoFinish(c.it.color);
  if (c.st.base === 'pedestal') {
    const foot = Math.min(w, d) * (round ? 0.28 : 0.22);
    cylinder(g, legs, foot, foot, 0.03, 0, 0, 0, 32);
    cylinder(g, legs, 0.05, 0.065, h - t - 0.03, 0, 0.03, 0, 20);
    return;
  }
  if (!round && h > 0.5 && c.st.legs !== 'hairpin' && c.st.legs !== 'sled') add(g, c.main, w - 0.14, 0.07, d - 0.14, 0, h - t - 0.07, 0);
  const lw = round ? w * 0.72 : w, ld = round ? d * 0.72 : d;
  legSet(g, c.st.legs, lw, ld, h - t, round ? 0.04 : 0.07, legs, Math.min(0.03, Math.min(w, d) * 0.06));
};

// ---------------------------------------------------------------- storage

interface Band { h: number; kind: 'drawer' | 'door' | 'open' | 'panel'; cells: number }

/**
 * A cabinet carcass from `y0` to `y0 + bodyH`, its front split into bands of
 * drawers, doors or open shelves. Open cells show the back panel and shelves.
 */
function cabinet(g: THREE.Group, c: Ctx, w: number, d: number, y0: number, bodyH: number, bands: Band[]) {
  const top = c.part('top', c.it.color, c.mainFinish);
  const fronts = c.part('fronts', c.it.color, c.mainFinish);
  const inner = autoFinish(shade(c.it.color, 0.82));
  const metal = metalMaterial(c.it.parts?.fronts?.finish === 'metal' ? '#2b2d30' : '#b9bcbf', 0.3);
  const t = BOARD;
  for (const sx of [-1, 1]) add(g, c.main, t, bodyH, d, sx * (w / 2 - t / 2), y0, 0);
  add(g, top, w, t, d, 0, y0 + bodyH - t, 0, 0.003);
  add(g, c.main, w - 2 * t, t, d, 0, y0, 0);
  add(g, inner, w - 2 * t, bodyH - 2 * t, 0.008, 0, y0 + t, -d / 2 + 0.004);
  const iw = w - 2 * t, innerH = bodyH - 2 * t;
  const total = bands.reduce((s, b) => s + b.h, 0) || 1;
  let y = y0 + bodyH - t;
  const fz = d / 2 - 0.009;
  for (const [bi, b] of bands.entries()) {
    const bh = (b.h / total) * innerH;
    y -= bh;
    const cw = iw / b.cells;
    if (bi > 0) add(g, c.main, iw, t * 0.8, d - 0.02, 0, y + bh - t * 0.4, 0);
    for (let k = 0; k < b.cells; k++) {
      const x = -iw / 2 + cw * (k + 0.5);
      if (b.kind === 'open') {
        if (k > 0) add(g, c.main, t * 0.8, bh, d - 0.02, x - cw / 2, y, 0);
        const shelves = Math.max(0, Math.round(bh / 0.35) - 1);
        for (let s = 1; s <= shelves; s++) add(g, c.main, cw - t, t * 0.8, d - 0.03, x, y + (bh * s) / (shelves + 1), -0.005);
        continue;
      }
      add(g, fronts, cw - 0.004, bh - 0.004, BOARD, x, y + 0.002, fz, 0.003);
      if (b.kind === 'drawer') handle(g, c.st.handles, x, y + bh * (c.st.handles === 'knob' ? 0.5 : 0.62), d / 2, metal);
      else if (b.kind === 'door') {
        // Pairs open from the middle; a single door from its right edge.
        const side = b.cells === 1 ? 1 : k % 2 === 0 ? 1 : -1;
        const hy = y + Math.min(bh * 0.6, Math.max(bh / 2, bh - 0.35)) + 0.08;
        handle(g, c.st.handles, x + side * (cw / 2 - 0.05), hy, d / 2, metal, true);
      }
    }
  }
}

/** Bands for a cabinet with `doors` and `drawers` (drawers in rows of up to the door count). */
function bands(st: ItemStyle, w: number, drawersAt: 'top' | 'bottom' = 'top'): Band[] {
  const doors = st.doors ?? 0, drawers = st.drawers ?? 0;
  const open = st.shelves === 'open';
  if (!doors && !drawers) return [{ h: 1, kind: open ? 'open' : 'panel', cells: open ? Math.max(1, Math.round(w / 0.8)) : 1 }];
  if (!doors) {
    const cols = drawers >= 4 && w > 1.1 ? 2 : 1;
    return Array.from({ length: Math.ceil(drawers / cols) }, () => ({ h: 1, kind: 'drawer' as const, cells: cols }));
  }
  const perRow = Math.max(1, Math.min(drawers || 1, Math.max(doors, 2)));
  const rows = drawers ? Math.ceil(drawers / perRow) : 0;
  const drawerBands: Band[] = Array.from({ length: rows }, () => ({ h: 0.17, kind: 'drawer', cells: perRow }));
  const doorBand: Band = { h: Math.max(0.2, 1 - rows * 0.17), kind: open ? 'open' : 'door', cells: doors };
  return drawersAt === 'top' ? [...drawerBands, doorBand] : [doorBand, ...drawerBands];
}

/** Legs (or a plinth) under a cabinet; returns the height the carcass starts at. */
function cabinetBase(g: THREE.Group, c: Ctx, w: number, d: number, maxLeg: number): number {
  const style = c.st.legs ?? 'plinth';
  const legH = style === 'plinth' ? 0.06 : Math.min(maxLeg, c.it.h * 0.3);
  legSet(g, style, w, d, legH, style === 'plinth' ? 0.03 : 0.05, style === 'plinth' ? autoFinish(shade(c.it.color, 0.6)) : c.legs(), 0.018);
  return legH;
}

const sideboard: StyledBuilder = (g, c) => {
  const { w, d, h } = c.it;
  const y0 = cabinetBase(g, c, w, d, 0.18);
  cabinet(g, c, w, d, y0, h - y0, bands(c.st, w));
};

const dresser: StyledBuilder = (g, c) => {
  const { w, d, h } = c.it;
  const y0 = cabinetBase(g, c, w, d, 0.12);
  cabinet(g, c, w, d, y0, h - y0, bands({ ...c.st, doors: 0 }, w));
};

const nightstand: StyledBuilder = (g, c) => {
  const { w, d, h } = c.it;
  const y0 = cabinetBase(g, c, w, d, 0.1);
  const drawers = c.st.drawers ?? 1;
  const rest: Band = { h: Math.max(0.3, 1 - drawers * 0.35), kind: c.st.shelves === 'open' ? 'open' : 'door', cells: 1 };
  const b: Band[] = [...Array.from({ length: drawers }, () => ({ h: 0.35, kind: 'drawer' as const, cells: 1 })), ...(drawers < 3 ? [rest] : [])];
  cabinet(g, c, w, d, y0, h - y0, b);
};

const wardrobe: StyledBuilder = (g, c) => {
  const { w, d, h } = c.it;
  add(g, autoFinish(shade(c.it.color, 0.6)), w - 0.04, 0.06, d - 0.04, 0, 0, -0.01);
  const st = { ...c.st, shelves: 'closed' as const };
  cabinet(g, c, w, d, 0.06, h - 0.06, bands(st, w, 'bottom').map((b) => (b.kind === 'drawer' ? { ...b, h: 0.12 } : b)));
};

const desk: StyledBuilder = (g, c) => {
  const { w, d, h } = c.it;
  add(g, c.main, w, 0.035, d, 0, h - 0.035, 0, 0.005);
  const drawers = c.st.drawers ?? 0;
  const legs = c.it.parts?.legs || c.st.legs !== 'square' ? c.legs() : metalMaterial(METAL, 0.45);
  if (drawers > 0) {
    const cw = Math.min(0.45, w * 0.35);
    const ped = new THREE.Group();
    ped.position.x = w / 2 - cw / 2 - 0.02;
    cabinet(ped, c, cw, d - 0.04, 0, h - 0.035, Array.from({ length: drawers }, () => ({ h: 1, kind: 'drawer' as const, cells: 1 })));
    g.add(ped);
    // Legs only under the free end.
    const lg = new THREE.Group();
    lg.position.x = -cw / 2;
    legSet(lg, c.st.legs, w - cw, d, h - 0.035, 0.04, legs, 0.02);
    lg.children.filter((m) => m.position.x > 0).forEach((m) => m.removeFromParent());
    g.add(lg);
  } else {
    legSet(g, c.st.legs, w, d, h - 0.035, 0.04, legs, 0.02);
  }
};

// --------------------------------------------------------------- shelving

const BOOK_COLORS = ['#8c3b2e', '#2f4a6b', '#d4b26a', '#4c6b45', '#6b4c6b', '#c9c1b5'];
function books(g: THREE.Group, x0: number, x1: number, y: number, maxH: number, d: number, seed: number, z = 0.01) {
  let x = x0, k = seed;
  while (x < x1) {
    const bw = 0.025 + ((k * 37) % 5) * 0.008;
    const bh = Math.min(maxH, 0.18 + ((k * 13) % 4) * 0.03);
    add(g, solid(BOOK_COLORS[k % BOOK_COLORS.length], 0.8), bw, bh, d, x + bw / 2, y, z);
    x += bw + 0.004;
    k++;
    if ((k * 7) % 11 === 0) x += 0.08;
  }
}

const bookshelf: StyledBuilder = (g, c) => {
  const { w, d, h } = c.it;
  const mat = c.part('frame', c.it.color, c.mainFinish);
  add(g, mat, 0.025, h, d, -w / 2 + 0.0125, 0, 0);
  add(g, mat, 0.025, h, d, w / 2 - 0.0125, 0, 0);
  add(g, mat, w, h, 0.01, 0, 0, -d / 2 + 0.005);
  const shelves = Math.max(2, Math.round(h / 0.35));
  for (let s = 0; s <= shelves; s++) {
    const y = (s * (h - 0.025)) / shelves;
    add(g, mat, w - 0.05, 0.025, d, 0, y, 0);
    if (s < shelves) books(g, -w / 2 + 0.04, w / 2 - 0.1, y + 0.025, h / shelves - 0.06, d * 0.75, s * 3);
  }
  if (c.st.shelves === 'closed') {
    const doors = c.st.doors ?? Math.max(1, Math.round(w / 0.45));
    const fronts = c.part('fronts', c.it.color, c.mainFinish);
    const dw = (w - 0.05) / doors;
    for (let k = 0; k < doors; k++) add(g, fronts, dw - 0.004, h - 0.03, BOARD, -w / 2 + 0.025 + dw * (k + 0.5), 0.015, d / 2 + BOARD / 2);
  }
};

/** Open shelving unit: posts at the corners and shelves, lightly dressed. */
const shelving: StyledBuilder = (g, c) => {
  const { w, d, h } = c.it;
  const frame = c.part('frame', c.it.color, c.mainFinish);
  const post = 0.03;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (w / 2 - post / 2), z = sz * (d / 2 - post / 2);
    if (c.st.legs === 'tapered') cylinder(g, frame, post / 2, post / 2, h, x, 0, z, 12);
    else add(g, frame, post, h, post, x, 0, z);
  }
  const n = Math.max(2, Math.round(h / 0.4));
  const shelf = c.main;
  for (let k = 0; k < n; k++) {
    const y = 0.08 + (k * (h - 0.11)) / (n - 1);
    add(g, shelf, w - 0.01, 0.025, d - 0.01, 0, y, 0, 0.003);
    if (k === n - 1) continue;
    const gap = (h - 0.11) / (n - 1) - 0.05;
    if (k % 2 === 0) books(g, -w / 2 + 0.05, -w / 2 + w * 0.45, y + 0.025, gap, d * 0.6, k * 5, -0.02);
    else {
      add(g, solid('#d9d2c5', 0.6), Math.min(0.25, w * 0.25), Math.min(0.12, gap), d * 0.5, w * 0.2, y + 0.025, 0, 0.01);
      cylinder(g, solid('#c9b9a5', 0.4), 0.05, 0.04, Math.min(0.2, gap), -w * 0.2, y + 0.025, 0, 16);
    }
  }
};

const counter: StyledBuilder = (g, c) => {
  const { w, d, h, color } = c.it;
  add(g, c.main, w, h - 0.14, d - 0.03, 0, 0.1, -0.015);
  add(g, solid('#3a3835', 0.9), w - 0.02, 0.1, d - 0.08, 0, 0, -0.04);
  add(g, c.part('top', '#dcd8d0', 'stone'), w, 0.04, d, 0, h - 0.04, 0, 0.004);
  const doors = Math.max(1, Math.round(w / 0.6));
  for (let k = 1; k < doors; k++) add(g, solid(shade(color, 0.8), 0.6), 0.004, h - 0.18, 0.004, -w / 2 + (w / doors) * k, 0.12, d / 2 - 0.028);
  if (w > 1.2) {
    add(g, metalMaterial('#b4b9bd', 0.25), 0.5, 0.012, 0.38, -w / 4, h, 0);
    for (const x of [w / 4 - 0.12, w / 4 + 0.12]) for (const z of [-0.1, 0.1]) cylinder(g, solid('#1e1f21', 0.5), 0.07, 0.07, 0.008, x, h, z);
  }
};

// ----------------------------------------------------- fallback (labelled)

const labelCache = new Map<string, THREE.MeshStandardMaterial>();
/** A paper label with the item's name, so an unmatched piece is still recognisable. */
function labelMaterial(text: string): THREE.MeshStandardMaterial | null {
  if (typeof document === 'undefined') return null;
  let m = labelCache.get(text);
  if (m) return m;
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 256;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fbfaf6';
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = '#3a3835';
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, 492, 236);
  ctx.fillStyle = '#2a2725';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Wrap onto at most three lines, shrinking the font for long names.
  const words = text.split(/\s+/);
  for (let size = 64; size >= 26; size -= 6) {
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    const lines: string[] = [];
    let line = '';
    for (const wd of words) {
      const next = line ? `${line} ${wd}` : wd;
      if (ctx.measureText(next).width > 450 && line) { lines.push(line); line = wd; } else line = next;
    }
    lines.push(line);
    if (lines.length <= 3 && lines.every((l) => ctx.measureText(l).width <= 470)) {
      lines.forEach((l, i) => ctx.fillText(l, 256, 128 + (i - (lines.length - 1) / 2) * size * 1.15));
      break;
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
  if (labelCache.size > 200) labelCache.clear();
  labelCache.set(text, m);
  return m;
}

const box: StyledBuilder = (g, c) => {
  const { w, d, h, name } = c.it;
  add(g, c.main, w, h, d, 0, 0, 0, 0.01);
  const label = labelMaterial(name.trim() || 'Item');
  if (!label) return;
  // On the front, sized to the face (2:1), and on the top.
  const lw = Math.min(w * 0.85, h * 0.85 * 2);
  const front = new THREE.Mesh(new THREE.PlaneGeometry(lw, lw / 2), label);
  front.position.set(0, h / 2, d / 2 + 0.002);
  g.add(front);
  const tw = Math.min(w * 0.85, d * 0.85 * 2);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(tw, tw / 2), label);
  top.rotation.x = -Math.PI / 2;
  top.position.set(0, h + 0.002, 0);
  g.add(top);
};

export const STYLED: Partial<Record<FurnitureType, StyledBuilder>> = {
  chair, armchair: upholstered, sofa: upholstered, stool, ottoman,
  bed, bunkbed, table, desk,
  sideboard, dresser, nightstand, wardrobe, bookshelf, shelving, counter, box,
};
