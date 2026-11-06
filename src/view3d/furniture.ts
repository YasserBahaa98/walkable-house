import * as THREE from 'three';
import type { Item } from '../model/types';
import { ceramicMaterial, fabricMaterial, metalMaterial, paintedMaterial, rugMaterial, solid, woodMaterial } from './materials';
import { add, autoFinish as finish, cylinder, makeCtx, METAL, shade } from './furnitureKit';
import { STYLED } from './furnitureStyled';

// Parametric furniture. Every builder returns a group whose origin is the
// bottom-centre of the footprint, with local +Z as the "front" of the piece.

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
const mirrorMaterial = new THREE.MeshStandardMaterial({ color: '#dfe7ec', roughness: 0.04, metalness: 1 });

type Builder = (g: THREE.Group, i: Item) => void;

/** Pieces without style options. */
const simple: Partial<Record<Item['type'], Builder>> = {
  fridge: (g, { w, d, h, color }) => {
    add(g, paintedMaterial(color, 0.3), w, h, d, 0, 0, 0, 0.03);
    add(g, solid(shade(color, 0.7), 0.4), w - 0.02, 0.006, 0.006, 0, h * 0.62, d / 2 + 0.001);
    add(g, solid(METAL, 0.3, 0.8), 0.02, h * 0.25, 0.03, w / 2 - 0.06, h * 0.68, d / 2 + 0.015);
  },
  tv: (g, { w, d, h, color }) => {
    add(g, solid(color, 0.3, 0.3), w, h, Math.max(0.03, d), 0, 0, 0, 0.005);
    add(g, screenMaterial, w - 0.03, h - 0.03, 0.004, 0, 0.015, Math.max(0.03, d) / 2 + 0.002);
  },
  rug: (g, { w, d, h, color }) => {
    add(g, rugMaterial(color), w, h, d, 0, 0, 0, 0.004);
    add(g, rugMaterial(shade(color, 0.75)), w * 0.8, h + 0.002, d * 0.75, 0, 0, 0);
    add(g, rugMaterial(color), w * 0.7, h + 0.004, d * 0.62, 0, 0, 0);
  },
  plant: (g, { w, h, color }) => {
    const pot = ceramicMaterial('#c9b9a5');
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
    const metal = metalMaterial(METAL, 0.4);
    cylinder(g, metal, w * 0.35, w * 0.4, 0.03, 0, 0, 0);
    cylinder(g, metal, 0.012, 0.012, h - 0.3, 0, 0.03, 0, 8);
    cylinder(g, lampShade(color), w * 0.3, w * 0.45, 0.3, 0, h - 0.3, 0);
  },
  toilet: (g, { w, d, h, color }) => {
    const p = ceramicMaterial(color);
    add(g, p, w * 0.8, h * 0.5, d * 0.55, 0, 0, d * 0.08, 0.08);
    add(g, p, w, h * 0.07, d * 0.62, 0, h * 0.5, d * 0.1, 0.1);
    add(g, p, w, h * 0.6, d * 0.25, 0, h * 0.4, -d / 2 + d * 0.125, 0.04);
  },
  bathtub: (g, { w, d, h, color }) => {
    const p = ceramicMaterial(color);
    add(g, p, w, h, d, 0, 0, 0, 0.05);
    add(g, solid('#d9e4ea', 0.1), w - 0.14, 0.01, d - 0.14, 0, h - 0.004, 0);
  },
  sink: (g, { w, d, h, color }) => {
    add(g, finish(shade(color, 0.85)), w, h - 0.05, d - 0.02, 0, 0, -0.01);
    add(g, ceramicMaterial(color), w, 0.05, d, 0, h - 0.05, 0, 0.02);
    add(g, solid('#dfe7ea', 0.1), w * 0.6, 0.005, d * 0.55, 0, h, 0.02);
    cylinder(g, metalMaterial('#c0c4c8', 0.15), 0.012, 0.012, 0.18, 0, h, -d / 2 + 0.06, 10);
    add(g, solid(METAL, 0.4, 0.5), Math.min(0.6, w * 0.9), 0.7, 0.02, 0, h + 0.3, -d / 2 + 0.01);
  },
  art: (g, { w, d, h, color }) => {
    // Framed abstract print: a few soft blocks of colour on a light canvas.
    const frame = woodMaterial('#3a2f26');
    add(g, frame, w, h, d * 0.6, 0, 0, -d * 0.2);
    add(g, solid('#f1ebe1', 0.95), w - 0.06, h - 0.06, d * 0.6, 0, 0.03, -d * 0.15);
    const z = d * 0.15 + 0.002;
    add(g, solid(color, 0.9), (w - 0.06) * 0.45, (h - 0.06) * 0.55, 0.004, -w * 0.14, h * 0.32, z);
    add(g, solid(shade(color, 0.55), 0.9), (w - 0.06) * 0.3, (h - 0.06) * 0.35, 0.004, w * 0.2, h * 0.16, z + 0.001);
    add(g, solid(shade(color, 1.35), 0.9), (w - 0.06) * 0.22, (h - 0.06) * 0.22, 0.004, w * 0.24, h * 0.62, z + 0.002);
  },
  mirror: (g, { w, d, h, color }) => {
    add(g, finish(color, 0.35), w, h, d, 0, 0, 0, 0.01);
    add(g, mirrorMaterial, w - 0.06, h - 0.06, 0.004, 0, 0.03, d / 2 + 0.002);
  },
  curtain: (g, { w, d, h, color }) => {
    // Open curtains: a rod across the window and a gathered panel at each side.
    add(g, metalMaterial(METAL, 0.4), w, 0.025, 0.025, 0, h - 0.03, 0);
    const fabric = fabricMaterial(color), fold = fabricMaterial(shade(color, 0.86));
    const panel = Math.min(0.45, w * 0.22);
    const folds = 5, fw = panel / folds;
    for (const side of [-1, 1]) {
      for (let k = 0; k < folds; k++) {
        const x = side * (w / 2 - panel + fw * (k + 0.5));
        add(g, k % 2 ? fold : fabric, fw + 0.01, h - 0.06, d * (k % 2 ? 0.45 : 0.8), x, 0.01, k % 2 ? -d * 0.1 : 0);
      }
    }
  },
  vase: (g, { w, h, color }) => {
    const vh = h * 0.45;
    cylinder(g, ceramicMaterial('#e9e4dc'), w * 0.3, w * 0.22, vh, 0, 0, 0, 16);
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
  model: (g, { w, d, h, color }) => add(g, solid(color, 0.75), w, h, d, 0, 0, 0, 0.02),
};

/** Build the 3D representation of a piece of furniture (without its world transform). */
export function buildFurniture(item: Item): THREE.Group {
  const g = new THREE.Group();
  const styled = STYLED[item.type];
  const plain = simple[item.type];
  if (styled) styled(g, makeCtx(item));
  else if (plain) plain(g, item);
  else STYLED.box!(g, makeCtx(item));
  return g;
}
