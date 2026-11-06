import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Item } from '../model/types';
import { solid } from './materials';

// Parametric furniture. Every builder returns a group whose origin is the
// bottom-centre of the footprint, with local +Z as the "front" of the piece.

const geoCache = new Map<string, THREE.BufferGeometry>();
function boxGeo(w: number, h: number, d: number, r = 0): THREE.BufferGeometry {
  const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${r.toFixed(3)}`;
  let g = geoCache.get(key);
  if (!g) {
    const rad = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
    g = rad > 0.002 ? new RoundedBoxGeometry(w, h, d, 2, rad) : new THREE.BoxGeometry(w, h, d);
    g.userData.shared = true; // cached: never disposed with a single piece of furniture
    geoCache.set(key, g);
  }
  return g;
}

function add(g: THREE.Group, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, r = 0) {
  if (w <= 0 || h <= 0 || d <= 0) return;
  const m = new THREE.Mesh(boxGeo(w, h, d, r), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
}

function cylinder(g: THREE.Group, mat: THREE.Material, rTop: number, rBot: number, h: number, x: number, y: number, z: number, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
}

const shade = (hex: string, f: number) => {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l * f)));
  return `#${c.getHexString()}`;
};

const WOOD = '#8a6748';

const screenMaterial = new THREE.MeshStandardMaterial({ color: '#0b0d10', roughness: 0.15, metalness: 0.2, emissive: '#101820', emissiveIntensity: 0.4 });
const shadeCache = new Map<string, THREE.MeshStandardMaterial>();
function lampShade(color: string): THREE.MeshStandardMaterial {
  let m = shadeCache.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, emissive: color, emissiveIntensity: 0.25, side: THREE.DoubleSide });
    shadeCache.set(color, m);
  }
  return m;
}
const METAL = '#2b2d30';
const mirrorMaterial = new THREE.MeshStandardMaterial({ color: '#dfe7ec', roughness: 0.04, metalness: 1 });
const WHITE = '#f4f3f0';

function legs(g: THREE.Group, w: number, d: number, h: number, inset: number, size: number, mat: THREE.Material) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    add(g, mat, size, h, size, sx * (w / 2 - inset), 0, sz * (d / 2 - inset));
  }
}

type Builder = (g: THREE.Group, i: Item) => void;

const builders: Record<Item['type'], Builder> = {
  bed: (g, { w, d, h, color }) => {
    const frame = solid(shade(color, 0.55), 0.8);
    add(g, frame, w, h * 0.45, d, 0, 0, 0, 0.02);
    add(g, solid(WHITE, 0.95), w - 0.06, h * 0.35, d - 0.08, 0, h * 0.45, 0.02, 0.06);
    add(g, solid(color, 0.95), w - 0.04, 0.06, d * 0.62, 0, h * 0.78, d * 0.18, 0.03);
    add(g, frame, w, Math.max(0.9, h * 1.8), 0.08, 0, 0, -d / 2 + 0.04, 0.02);
    const pw = w > 1.2 ? (w - 0.2) / 2 : w - 0.2;
    for (const x of w > 1.2 ? [-pw / 2 - 0.05, pw / 2 + 0.05] : [0]) {
      add(g, solid('#fbfaf7', 1), pw, 0.12, 0.38, x, h * 0.78, -d / 2 + 0.3, 0.05);
    }
  },
  sofa: (g, { w, d, h, color }) => {
    const fab = solid(color, 0.95), dark = solid(shade(color, 0.8), 0.95);
    const arm = Math.min(0.2, w * 0.12);
    add(g, solid(METAL, 0.4, 0.6), w - 0.1, 0.08, d - 0.1, 0, 0, 0);
    add(g, dark, w, h * 0.32, d, 0, 0.08, 0, 0.04);
    const seats = Math.max(1, Math.round((w - arm * 2) / 0.7));
    const sw = (w - arm * 2) / seats;
    for (let s = 0; s < seats; s++) add(g, fab, sw - 0.02, h * 0.16, d - 0.25, -w / 2 + arm + sw * (s + 0.5), 0.08 + h * 0.32, 0.08, 0.05);
    add(g, fab, w - arm * 2, h * 0.5, 0.2, 0, 0.08 + h * 0.32, -d / 2 + 0.12, 0.06);
    for (const sx of [-1, 1]) add(g, dark, arm, h * 0.42, d, sx * (w / 2 - arm / 2), 0.08 + h * 0.2, 0, 0.05);
  },
  armchair: (g, i) => builders.sofa(g, i),
  table: (g, { w, d, h, color }) => {
    const top = solid(color, 0.5);
    const t = Math.min(0.04, h * 0.1);
    add(g, top, w, t, d, 0, h - t, 0, 0.01);
    legs(g, w, d, h - t, 0.06, 0.05, solid(shade(color, 0.6), 0.6));
  },
  desk: (g, { w, d, h, color }) => {
    add(g, solid(color, 0.5), w, 0.035, d, 0, h - 0.035, 0, 0.005);
    add(g, solid(shade(color, 0.85), 0.6), Math.min(0.45, w * 0.35), h - 0.035, d - 0.04, w / 2 - Math.min(0.45, w * 0.35) / 2 - 0.02, 0, 0);
    for (const x of [-w / 2 + 0.04]) for (const z of [-d / 2 + 0.04, d / 2 - 0.04]) add(g, solid(METAL, 0.4, 0.6), 0.04, h - 0.035, 0.04, x, 0, z);
  },
  chair: (g, { w, d, h, color }) => {
    const mat = solid(color, 0.7);
    const seatH = Math.min(0.46, h * 0.52);
    add(g, mat, w, 0.04, d * 0.9, 0, seatH - 0.04, 0.02, 0.01);
    legs(g, w, d * 0.9, seatH - 0.04, 0.03, 0.03, solid(WOOD, 0.6));
    add(g, mat, w, h - seatH, 0.04, 0, seatH, -d / 2 + 0.04, 0.01);
  },
  wardrobe: (g, { w, d, h, color }) => {
    const body = solid(color, 0.6);
    add(g, body, w, h, d, 0, 0, 0, 0.01);
    const doors = Math.max(1, Math.round(w / 0.5));
    const dw = w / doors;
    for (let k = 1; k < doors; k++) add(g, solid(shade(color, 0.7), 0.6), 0.006, h - 0.1, 0.004, -w / 2 + dw * k, 0.05, d / 2 + 0.002);
    for (let k = 0; k < doors; k++) add(g, solid(METAL, 0.3, 0.8), 0.015, 0.18, 0.02, -w / 2 + dw * k + (k % 2 ? 0.05 : dw - 0.05), h * 0.48, d / 2 + 0.01);
  },
  bookshelf: (g, { w, d, h, color }) => {
    const mat = solid(color, 0.7);
    add(g, mat, 0.025, h, d, -w / 2 + 0.0125, 0, 0);
    add(g, mat, 0.025, h, d, w / 2 - 0.0125, 0, 0);
    add(g, mat, w, h, 0.01, 0, 0, -d / 2 + 0.005);
    const shelves = Math.max(2, Math.round(h / 0.35));
    const colors = ['#8c3b2e', '#2f4a6b', '#d4b26a', '#4c6b45', '#6b4c6b', '#c9c1b5'];
    for (let s = 0; s <= shelves; s++) {
      const y = (s * (h - 0.025)) / shelves;
      add(g, mat, w - 0.05, 0.025, d, 0, y, 0);
      if (s === shelves) continue;
      let x = -w / 2 + 0.04;
      let k = s * 3;
      while (x < w / 2 - 0.1) {
        const bw = 0.025 + ((k * 37) % 5) * 0.008;
        const bh = Math.min(h / shelves - 0.06, 0.18 + ((k * 13) % 4) * 0.03);
        add(g, solid(colors[k % colors.length], 0.8), bw, bh, d * 0.75, x + bw / 2, y + 0.025, 0.01);
        x += bw + 0.004;
        k++;
        if ((k * 7) % 11 === 0) x += 0.08;
      }
    }
  },
  counter: (g, { w, d, h, color }) => {
    add(g, solid(color, 0.55), w, h - 0.04, d - 0.03, 0, 0.1, -0.015);
    add(g, solid('#3a3835', 0.9), w - 0.02, 0.1, d - 0.08, 0, 0, -0.04);
    add(g, solid('#d8d4cc', 0.25), w, 0.04, d, 0, h - 0.04, 0);
    const doors = Math.max(1, Math.round(w / 0.6));
    for (let k = 1; k < doors; k++) add(g, solid(shade(color, 0.8), 0.6), 0.004, h - 0.18, 0.004, -w / 2 + (w / doors) * k, 0.12, d / 2 - 0.028);
    if (w > 1.2) {
      add(g, solid('#9aa0a6', 0.25, 0.8), 0.5, 0.012, 0.38, -w / 4, h, 0);
      for (const x of [w / 4 - 0.12, w / 4 + 0.12]) for (const z of [-0.1, 0.1]) cylinder(g, solid('#1e1f21', 0.5), 0.07, 0.07, 0.008, x, h, z);
    }
  },
  fridge: (g, { w, d, h, color }) => {
    add(g, solid(color, 0.3, 0.4), w, h, d, 0, 0, 0, 0.03);
    add(g, solid(shade(color, 0.7), 0.4), w - 0.02, 0.006, 0.006, 0, h * 0.62, d / 2 + 0.001);
    add(g, solid(METAL, 0.3, 0.8), 0.02, h * 0.25, 0.03, w / 2 - 0.06, h * 0.68, d / 2 + 0.015);
  },
  tv: (g, { w, d, h, color }) => {
    add(g, solid(color, 0.3, 0.3), w, h, Math.max(0.03, d), 0, 0, 0, 0.005);
    add(g, screenMaterial, w - 0.03, h - 0.03, 0.004, 0, 0.015, Math.max(0.03, d) / 2 + 0.002);
  },
  rug: (g, { w, d, h, color }) => {
    add(g, solid(color, 1), w, h, d, 0, 0, 0, 0.004);
    add(g, solid(shade(color, 0.75), 1), w * 0.8, h + 0.002, d * 0.75, 0, 0, 0);
    add(g, solid(color, 1), w * 0.7, h + 0.004, d * 0.62, 0, 0, 0);
  },
  plant: (g, { w, h, color }) => {
    const pot = solid('#c9b9a5', 0.8);
    const potH = Math.min(0.4, h * 0.3);
    cylinder(g, pot, w * 0.36, w * 0.28, potH, 0, 0, 0);
    const leaf = solid(color, 0.8);
    const r = w * 0.45;
    for (let k = 0; k < 5; k++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r * (0.75 + (k % 3) * 0.12), 1), leaf);
      const a = (k / 5) * Math.PI * 2;
      m.position.set(Math.cos(a) * r * 0.35, potH + (h - potH) * (0.35 + (k % 3) * 0.2), Math.sin(a) * r * 0.35);
      m.castShadow = true;
      g.add(m);
    }
  },
  lamp: (g, { w, h, color }) => {
    const metal = solid(METAL, 0.4, 0.7);
    cylinder(g, metal, w * 0.35, w * 0.4, 0.03, 0, 0, 0);
    cylinder(g, metal, 0.012, 0.012, h - 0.3, 0, 0.03, 0, 8);
    cylinder(g, lampShade(color), w * 0.3, w * 0.45, 0.3, 0, h - 0.3, 0);
  },
  toilet: (g, { w, d, h, color }) => {
    const p = solid(color, 0.2);
    add(g, p, w * 0.8, h * 0.5, d * 0.55, 0, 0, d * 0.08, 0.08);
    add(g, p, w, h * 0.07, d * 0.62, 0, h * 0.5, d * 0.1, 0.1);
    add(g, p, w, h * 0.6, d * 0.25, 0, h * 0.4, -d / 2 + d * 0.125, 0.04);
  },
  bathtub: (g, { w, d, h, color }) => {
    const p = solid(color, 0.2);
    add(g, p, w, h, d, 0, 0, 0, 0.05);
    add(g, solid('#d9e4ea', 0.1), w - 0.14, 0.01, d - 0.14, 0, h - 0.004, 0);
  },
  sink: (g, { w, d, h, color }) => {
    add(g, solid(shade(color, 0.85), 0.6), w, h - 0.05, d - 0.02, 0, 0, -0.01);
    add(g, solid(color, 0.15), w, 0.05, d, 0, h - 0.05, 0, 0.02);
    add(g, solid('#dfe7ea', 0.1), w * 0.6, 0.005, d * 0.55, 0, h, 0.02);
    cylinder(g, solid('#c0c4c8', 0.2, 0.9), 0.012, 0.012, 0.18, 0, h, -d / 2 + 0.06, 10);
    add(g, solid(METAL, 0.4, 0.5), Math.min(0.6, w * 0.9), 0.7, 0.02, 0, h + 0.3, -d / 2 + 0.01);
  },
  art: (g, { w, d, h, color }) => {
    // Framed abstract print: a few soft blocks of colour on a light canvas.
    const frame = solid('#2c2925', 0.6);
    add(g, frame, w, h, d * 0.6, 0, 0, -d * 0.2);
    add(g, solid('#f1ebe1', 0.95), w - 0.06, h - 0.06, d * 0.6, 0, 0.03, -d * 0.15);
    const z = d * 0.15 + 0.002;
    add(g, solid(color, 0.9), (w - 0.06) * 0.45, (h - 0.06) * 0.55, 0.004, -w * 0.14, h * 0.32, z);
    add(g, solid(shade(color, 0.55), 0.9), (w - 0.06) * 0.3, (h - 0.06) * 0.35, 0.004, w * 0.2, h * 0.16, z + 0.001);
    add(g, solid(shade(color, 1.35), 0.9), (w - 0.06) * 0.22, (h - 0.06) * 0.22, 0.004, w * 0.24, h * 0.62, z + 0.002);
  },
  mirror: (g, { w, d, h, color }) => {
    add(g, solid(color, 0.45, 0.5), w, h, d, 0, 0, 0, 0.01);
    add(g, mirrorMaterial, w - 0.06, h - 0.06, 0.004, 0, 0.03, d / 2 + 0.002);
  },
  curtain: (g, { w, d, h, color }) => {
    // Open curtains: a rod across the window and a gathered panel at each side.
    add(g, solid(METAL, 0.4, 0.7), w, 0.025, 0.025, 0, h - 0.03, 0);
    const fabric = solid(color, 0.98), fold = solid(shade(color, 0.86), 0.98);
    const panel = Math.min(0.45, w * 0.22);
    const folds = 5, fw = panel / folds;
    for (const side of [-1, 1]) {
      for (let k = 0; k < folds; k++) {
        const x = side * (w / 2 - panel + fw * (k + 0.5));
        add(g, k % 2 ? fold : fabric, fw + 0.01, h - 0.06, d * (k % 2 ? 0.45 : 0.8), x, 0.01, k % 2 ? -d * 0.1 : 0);
      }
    }
  },
  nightstand: (g, { w, d, h, color }) => {
    add(g, solid(color, 0.6), w, h - 0.06, d, 0, 0.06, 0, 0.01);
    legs(g, w, d, 0.06, 0.03, 0.03, solid(shade(color, 0.6), 0.6));
    add(g, solid(shade(color, 0.85), 0.6), w - 0.04, 0.004, 0.004, 0, h * 0.55, d / 2 + 0.001);
    add(g, solid(METAL, 0.3, 0.8), 0.08, 0.015, 0.02, 0, h * 0.72, d / 2 + 0.01);
  },
  vase: (g, { w, h, color }) => {
    const vh = h * 0.45;
    cylinder(g, solid('#e9e4dc', 0.25), w * 0.3, w * 0.22, vh, 0, 0, 0, 16);
    const stem = solid('#5b7a4b', 0.8), bloom = solid(color, 0.7);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2, r = w * (0.12 + (k % 2) * 0.12);
      const top = vh + (h - vh) * (0.7 + (k % 3) * 0.12);
      cylinder(g, stem, 0.004, 0.004, top - vh + 0.02, Math.cos(a) * r * 0.5, vh - 0.02, Math.sin(a) * r * 0.5, 5);
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(w * 0.13, 1), bloom);
      m.position.set(Math.cos(a) * r, top, Math.sin(a) * r);
      m.castShadow = true;
      g.add(m);
    }
  },
  box: (g, { w, d, h, color }) => add(g, solid(color, 0.75), w, h, d, 0, 0, 0, 0.02),
  model: (g, { w, d, h, color }) => add(g, solid(color, 0.75), w, h, d, 0, 0, 0, 0.02),
};

/** Build the 3D representation of a piece of furniture (without its world transform). */
export function buildFurniture(item: Item): THREE.Group {
  const g = new THREE.Group();
  builders[item.type](g, item);
  return g;
}
