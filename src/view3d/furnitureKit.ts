import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Item } from '../model/types';
import { resolveStyle, TYPE_FINISH, type Finish, type ItemStyle, type PartName } from '../model/styles';
import { boxUV, finishMaterial, metalMaterial, paintedMaterial, woodMaterial } from './materials';

// Building blocks shared by the furniture builders. Every piece is built in
// its own frame: origin at the bottom-centre of the footprint, +Z is the front.

export const WOOD = '#8a6748';
export const METAL = '#2b2d30';
export const WHITE = '#f4f3f0';

const geoCache = new Map<string, THREE.BufferGeometry>();
export function boxGeo(w: number, h: number, d: number, r = 0): THREE.BufferGeometry {
  const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${r.toFixed(3)}`;
  let g = geoCache.get(key);
  if (!g) {
    const rad = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
    // Soft, well-rounded pieces (cushions, mattresses) get more segments.
    g = boxUV(rad > 0.002 ? new RoundedBoxGeometry(w, h, d, rad >= 0.04 ? 4 : 2, rad) : new THREE.BoxGeometry(w, h, d));
    g.userData.shared = true; // cached: never disposed with a single piece of furniture
    geoCache.set(key, g);
  }
  return g;
}

function mesh(g: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

/** Box of size w×h×d whose bottom-centre sits at (x, y, z). */
export function add(g: THREE.Group, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, r = 0): THREE.Mesh | null {
  if (w <= 0 || h <= 0 || d <= 0) return null;
  const m = mesh(g, boxGeo(w, h, d, r), mat);
  m.position.set(x, y + h / 2, z);
  return m;
}

function cylGeo(rTop: number, rBot: number, h: number, seg: number): THREE.CylinderGeometry {
  const geo = new THREE.CylinderGeometry(rTop, rBot, h, seg);
  // UVs in metres (around × up) so wood grain and fabric keep their scale.
  const uv = geo.getAttribute('uv'), around = Math.PI * (rTop + rBot);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * around, uv.getY(i) * h);
  return geo;
}

/** Upright cylinder whose bottom-centre sits at (x, y, z). */
export function cylinder(g: THREE.Group, mat: THREE.Material, rTop: number, rBot: number, h: number, x: number, y: number, z: number, seg = 20): THREE.Mesh {
  const m = mesh(g, cylGeo(rTop, rBot, h, seg), mat);
  m.position.set(x, y + h / 2, z);
  return m;
}

/** Thin round bar between two points (hairpin legs, frames, ladder rails). */
export function rod(g: THREE.Group, mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 8): void {
  const len = a.distanceTo(b);
  if (len < 1e-4) return;
  const m = mesh(g, cylGeo(r, r, len, seg), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
}

export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export const shade = (hex: string, f: number) => {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l * f)));
  return `#${c.getHexString()}`;
};

/**
 * Wood grain for natural wood colours; a smooth painted finish for whites,
 * greys, blacks and strong colours, where grain would look wrong.
 */
export function autoFinish(color: string, roughness?: number): THREE.Material {
  const hsl = { h: 0, s: 0, l: 0 };
  // Judge the colour as people see it (sRGB), not in linear light.
  new THREE.Color(color).getHSL(hsl, THREE.SRGBColorSpace);
  const woody = hsl.s >= 0.15 && hsl.s <= 0.75 && hsl.l >= 0.1 && hsl.l <= 0.72 && (hsl.h < 0.17 || hsl.h > 0.95);
  return woody ? woodMaterial(color) : paintedMaterial(color, roughness);
}

/** Material for a finish, or the automatic wood/paint choice. */
export function material(finish: Finish | 'auto', color: string): THREE.Material {
  return finish === 'auto' ? autoFinish(color) : finishMaterial(finish, color);
}

/** Everything a builder needs about an item: its resolved style and materials. */
export interface Ctx {
  it: Item;
  st: ItemStyle;
  /** Main colour's finish (the item's, the type's default, or auto). */
  mainFinish: Finish | 'auto';
  main: THREE.Material;
  /** A part's material: the item's override, else the given default colour and finish. */
  part(name: PartName, color: string, finish?: Finish | 'auto'): THREE.Material;
  /** Default material for legs of the current leg style. */
  legs(): THREE.Material;
}

export function makeCtx(it: Item): Ctx {
  const st = resolveStyle(it);
  const mainFinish: Finish | 'auto' = it.finish ?? TYPE_FINISH[it.type] ?? 'auto';
  const part = (name: PartName, color: string, finish: Finish | 'auto' = 'auto') => {
    const p = it.parts?.[name];
    return material(p?.finish ?? finish, p?.color ?? color);
  };
  return {
    it, st, mainFinish, part,
    main: material(mainFinish, it.color),
    legs: () => {
      if (st.legs === 'hairpin' || st.legs === 'sled') return it.parts?.legs ? part('legs', METAL, 'metal') : metalMaterial(METAL, 0.4);
      return part('legs', WOOD, 'wood');
    },
  };
}

/**
 * Legs or base in the given style under a w×d footprint, `h` tall.
 * `inset` is the distance from the footprint edge to the leg centres.
 */
export function legSet(g: THREE.Group, style: ItemStyle['legs'], w: number, d: number, h: number, inset: number, mat: THREE.Material, r = 0.02): void {
  if (h <= 0.005) return;
  const xs = w / 2 - inset, zs = d / 2 - inset;
  switch (style) {
    case 'square':
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, mat, r * 1.7, h, r * 1.7, sx * xs, 0, sz * zs, 0.003);
      break;
    case 'hairpin':
      // Two thin rods per leg meeting at the floor, splayed slightly outwards.
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const foot = v3(sx * (xs + 0.015), 0, sz * (zs + 0.015));
        rod(g, mat, foot, v3(sx * xs, h, sz * (zs - 0.05)), 0.005, 6);
        rod(g, mat, foot, v3(sx * (xs - 0.05), h, sz * zs), 0.005, 6);
      }
      break;
    case 'sled':
      // A closed loop on each side: floor runner, two uprights, top rail.
      for (const sx of [-1, 1]) {
        const x = sx * xs, rr = Math.max(0.008, r * 0.5);
        rod(g, mat, v3(x, rr, -zs), v3(x, rr, zs), rr);
        rod(g, mat, v3(x, 0, -zs), v3(x, h, -zs), rr);
        rod(g, mat, v3(x, 0, zs), v3(x, h, zs), rr);
        rod(g, mat, v3(x, h - rr, -zs), v3(x, h - rr, zs), rr);
      }
      break;
    case 'plinth':
      add(g, mat, Math.max(0.02, w - inset * 2), h, Math.max(0.02, d - inset * 2), 0, 0, 0);
      break;
    default: // tapered
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) cylinder(g, mat, r, r * 0.65, h, sx * xs, 0, sz * zs, 12);
  }
}

/** A handle centred at (x, y, z) on a front; bars run along the given axis. */
export function handle(g: THREE.Group, style: ItemStyle['handles'], x: number, y: number, z: number, mat: THREE.Material, vertical = false): void {
  if (style === 'none') return;
  if (style === 'knob') { add(g, mat, 0.03, 0.03, 0.025, x, y - 0.015, z + 0.0125, 0.012); return; }
  if (vertical) add(g, mat, 0.014, 0.16, 0.022, x, y - 0.08, z + 0.011, 0.005);
  else add(g, mat, Math.min(0.16, 0.14), 0.014, 0.022, x, y - 0.007, z + 0.011, 0.005);
}
