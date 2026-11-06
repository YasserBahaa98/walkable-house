import * as THREE from 'three';
import type { FloorMaterial } from '../model/types';
import type { Finish } from '../model/styles';

// Surfaces use photo-scanned PBR textures (public/textures, CC0) loaded on
// demand. Until a texture has loaded (or when it can't be fetched offline) the
// material keeps a small procedural stand-in drawn on a canvas, so nothing ever
// renders black. All textures tile in world space: 1 repeat = `size` metres.

type Painter = (ctx: CanvasRenderingContext2D, n: number) => void;

function canvasTexture(paint: Painter, n = 512, color = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  paint(ctx, n);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ------------------------------------------------------------ photo textures

/** Texture resolution: 1k for the High quality setting, 512 for Fast. */
export type TextureQuality = '1k' | '512';
let quality: TextureQuality = '1k';
let anisotropy = 8;
let changed: () => void = () => {};

/** Called whenever a texture finishes loading, so the view can redraw. */
export function onTexturesChanged(cb: () => void) { changed = cb; }

interface PbrSpec {
  /** File prefix in public/textures/<quality>/. */
  name: string;
  /** Which maps exist: c(olour), n(ormal), r(oughness). */
  maps: string;
  /** Metres per texture repeat. */
  size: number;
  /** Use another material's normal map (e.g. rugs share the carpet's). */
  normalFrom?: string;
  normalScale?: number;
}

interface Slot { mat: THREE.MeshStandardMaterial; spec: PbrSpec; loaded: THREE.Texture[]; roughness: number }
const slots: Slot[] = [];
const loader = typeof document === 'undefined' ? null : new THREE.TextureLoader();

function textureUrl(file: string) {
  return `${import.meta.env.BASE_URL}textures/${quality}/${file}.webp`;
}

function loadInto(slot: Slot) {
  if (!loader) return;
  const { mat, spec } = slot;
  const q = quality;
  const want: [keyof THREE.MeshStandardMaterial & ('map' | 'normalMap' | 'roughnessMap'), string, boolean][] = [];
  if (spec.maps.includes('c')) want.push(['map', `${spec.name}_col`, true]);
  // Fast keeps shaders light: colour only, no normal or roughness maps.
  if (q === '1k' && (spec.maps.includes('n') || spec.normalFrom)) want.push(['normalMap', `${spec.normalFrom ?? spec.name}_nor`, false]);
  if (q === '1k' && spec.maps.includes('r')) want.push(['roughnessMap', `${spec.name}_rough`, false]);
  for (const [key, file, srgb] of want) {
    loader.load(textureUrl(file), (tex) => {
      if (q !== quality) { tex.dispose(); return; }
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(1 / spec.size, 1 / spec.size);
      tex.anisotropy = anisotropy;
      if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
      const old = mat[key];
      if (old && !(old instanceof THREE.CanvasTexture)) old.dispose();
      mat[key] = tex;
      if (key === 'normalMap') { mat.normalScale.setScalar(spec.normalScale ?? 1); mat.bumpMap = null; }
      if (key === 'roughnessMap') mat.roughness = 1;
      mat.needsUpdate = true;
      slot.loaded.push(tex);
      changed();
    }, undefined, () => { /* offline or missing: keep the procedural stand-in */ });
  }
}

/** Attach photo textures to a material; they replace its stand-in maps once loaded. */
function pbr<T extends THREE.MeshStandardMaterial>(mat: T, spec: PbrSpec): T {
  const slot: Slot = { mat, spec, loaded: [], roughness: mat.roughness };
  slots.push(slot);
  loadInto(slot);
  return mat;
}

/** Switch texture resolution (and filtering) for every material, reloading maps. */
export function setTextureQuality(q: TextureQuality, maxAnisotropy = 8) {
  anisotropy = Math.min(maxAnisotropy, q === '1k' ? 8 : 4);
  if (q === quality) return;
  quality = q;
  for (const s of slots) {
    if (q === '512') {
      // Drop the detail maps; the material's own roughness/bump stand in.
      s.mat.normalMap?.dispose();
      s.mat.roughnessMap?.dispose();
      s.mat.normalMap = null;
      s.mat.roughnessMap = null;
      s.mat.roughness = s.roughness;
      s.mat.needsUpdate = true;
    }
    s.loaded = [];
    loadInto(s);
  }
  for (const [m, v] of physical) {
    m.sheen = q === '1k' ? v.sheen : 0;
    m.clearcoat = q === '1k' ? v.clearcoat : 0;
  }
}

/** Physical materials and their effects; sheen and clearcoat are switched off on Fast. */
const physical = new Map<THREE.MeshPhysicalMaterial, { sheen: number; clearcoat: number }>();
function effects(m: THREE.MeshPhysicalMaterial): THREE.MeshPhysicalMaterial {
  physical.set(m, { sheen: m.sheen, clearcoat: m.clearcoat });
  if (quality !== '1k') { m.sheen = 0; m.clearcoat = 0; }
  return m;
}

/** URL of a material's colour texture, for UI swatches. */
export function textureSwatchUrl(name: string) {
  return `${import.meta.env.BASE_URL}textures/512/${name}_col.webp`;
}

/**
 * Box-projected UVs in metres: each face takes the two axes it spans, so a
 * texture keeps its real-world scale on any box, whatever its size.
 */
export function boxUV(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.getAttribute('position'), nor = geo.getAttribute('normal');
  if (!nor) return geo;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (ay >= ax && ay >= az) { uv[i * 2] = x; uv[i * 2 + 1] = z; }
    else if (ax >= az) { uv[i * 2] = z; uv[i * 2 + 1] = y; }
    else { uv[i * 2] = x; uv[i * 2 + 1] = y; }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** Deterministic pseudo-random generator so textures look the same every load. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function noise(ctx: CanvasRenderingContext2D, n: number, amount: number, seed: number) {
  const img = ctx.getImageData(0, 0, n, n);
  const r = rng(seed);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (r() - 0.5) * amount;
    img.data[i] += v; img.data[i + 1] += v; img.data[i + 2] += v;
  }
  ctx.putImageData(img, 0, 0);
}

const planks = (base: [number, number, number], vary: number, seed: number): Painter => (ctx, n) => {
  const r = rng(seed);
  const rows = 8;
  const h = n / rows;
  for (let row = 0; row < rows; row++) {
    let x = -r() * n * 0.5;
    while (x < n) {
      const len = n * (0.35 + r() * 0.45);
      const t = (r() - 0.5) * vary;
      ctx.fillStyle = `rgb(${base[0] + t * 1.1},${base[1] + t},${base[2] + t * 0.8})`;
      ctx.fillRect(x, row * h, len, h);
      // grain
      ctx.strokeStyle = 'rgba(60,35,15,0.10)';
      ctx.lineWidth = 1;
      for (let g = 0; g < 6; g++) {
        const y = row * h + r() * h;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + len * 0.3, y + (r() - 0.5) * 6, x + len * 0.6, y + (r() - 0.5) * 6, x + len, y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(40,25,10,0.35)';
      ctx.fillRect(x, row * h, 1.5, h);
      x += len;
    }
    ctx.fillStyle = 'rgba(40,25,10,0.3)';
    ctx.fillRect(0, row * h, n, 1.5);
  }
  noise(ctx, n, 10, seed + 1);
};

const PAINTERS: Record<FloorMaterial, { paint: Painter; size: number; roughness: number; photo: number }> = {
  oak: { paint: planks([196, 160, 118], 26, 7), size: 2.4, roughness: 0.62, photo: 1.7 },
  walnut: { paint: planks([118, 82, 56], 22, 11), size: 2.4, roughness: 0.55, photo: 1.7 },
  tile: {
    size: 1.2, roughness: 0.35, photo: 1.2,
    paint: (ctx, n) => {
      ctx.fillStyle = '#d9d6d0';
      ctx.fillRect(0, 0, n, n);
      const r = rng(3);
      const k = 4, s = n / k;
      for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
        const t = (r() - 0.5) * 10;
        ctx.fillStyle = `rgb(${236 + t},${233 + t},${227 + t})`;
        ctx.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
      }
      noise(ctx, n, 6, 4);
    },
  },
  marble: {
    size: 1.6, roughness: 0.18, photo: 2.0,
    paint: (ctx, n) => {
      ctx.fillStyle = '#eeece8';
      ctx.fillRect(0, 0, n, n);
      const r = rng(9);
      for (let v = 0; v < 18; v++) {
        ctx.strokeStyle = `rgba(120,120,125,${0.05 + r() * 0.12})`;
        ctx.lineWidth = 0.5 + r() * 2;
        ctx.beginPath();
        let x = r() * n, y = 0;
        ctx.moveTo(x, y);
        while (y < n) { x += (r() - 0.5) * 40; y += 20 + r() * 30; ctx.lineTo(x, y); }
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(160,160,160,0.6)';
      for (let i = 0; i <= 2; i++) { ctx.fillRect(0, (i * n) / 2, n, 1); ctx.fillRect((i * n) / 2, 0, 1, n); }
      noise(ctx, n, 5, 10);
    },
  },
  carpet: {
    size: 1.0, roughness: 0.95, photo: 0.8,
    paint: (ctx, n) => {
      ctx.fillStyle = '#b9b0a4';
      ctx.fillRect(0, 0, n, n);
      noise(ctx, n, 34, 21);
    },
  },
  concrete: {
    size: 3.0, roughness: 0.85, photo: 3.0,
    paint: (ctx, n) => {
      ctx.fillStyle = '#a9a8a4';
      ctx.fillRect(0, 0, n, n);
      const r = rng(5);
      for (let i = 0; i < 400; i++) {
        ctx.fillStyle = `rgba(${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},0.025)`;
        const s = 4 + r() * 30;
        ctx.beginPath(); ctx.arc(r() * n, r() * n, s, 0, Math.PI * 2); ctx.fill();
      }
      noise(ctx, n, 14, 6);
    },
  },
};

const floorCache = new Map<FloorMaterial, THREE.MeshStandardMaterial>();

/** Floor materials use world-space UVs (see `worldUV`), so `size` sets the tile scale. */
export function floorMaterial(kind: FloorMaterial): THREE.MeshStandardMaterial {
  let m = floorCache.get(kind);
  if (!m) {
    const p = PAINTERS[kind];
    const map = canvasTexture(p.paint);
    map.repeat.set(1 / p.size, 1 / p.size);
    m = pbr(new THREE.MeshStandardMaterial({ map, roughness: p.roughness, metalness: 0 }),
      { name: `floor_${kind}`, maps: 'cnr', size: p.photo, normalScale: 0.8 });
    floorCache.set(kind, m);
  }
  return m;
}

/** Small swatch for the UI, rendered from the same painter as the 3D floor. */
export function floorSwatch(kind: FloorMaterial, size = 48): string {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  PAINTERS[kind].paint(c.getContext('2d')!, 256);
  const out = document.createElement('canvas');
  out.width = out.height = size;
  out.getContext('2d')!.drawImage(c, 0, 0, 256, 256, 0, 0, size, size);
  return out.toDataURL();
}

let plaster: THREE.CanvasTexture | null = null;
function plasterTexture(): THREE.CanvasTexture {
  plaster ??= canvasTexture((ctx, n) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, n, n);
    noise(ctx, n, 18, 42);
  }, 256, false);
  return plaster;
}

const wallCache = new Map<string, THREE.MeshStandardMaterial>();
export function wallMaterial(color = '#f2eee8'): THREE.MeshStandardMaterial {
  let m = wallCache.get(color);
  if (!m) {
    const bump = plasterTexture();
    m = pbr(new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, bumpMap: bump, bumpScale: 0.4 }),
      { name: 'wall_plaster', maps: 'nr', size: 1.0, normalScale: 0.35 });
    wallCache.set(color, m);
  }
  return m;
}

let grass: THREE.MeshStandardMaterial | null = null;
export function groundMaterial(): THREE.MeshStandardMaterial {
  if (!grass) {
    const map = canvasTexture((ctx, n) => {
      ctx.fillStyle = '#7d9466';
      ctx.fillRect(0, 0, n, n);
      noise(ctx, n, 30, 77);
    }, 256);
    map.repeat.set(1 / 4, 1 / 4);
    grass = pbr(new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0 }), { name: 'ground_grass', maps: 'c', size: 2.5 });
  }
  return grass;
}

const colorCache = new Map<string, THREE.MeshStandardMaterial>();
/** Shared plain material by colour and finish. */
export function solid(color: string, roughness = 0.7, metalness = 0): THREE.MeshStandardMaterial {
  const key = `${color}|${roughness}|${metalness}`;
  let m = colorCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    colorCache.set(key, m);
  }
  return m;
}

export const glassMaterial = new THREE.MeshStandardMaterial({
  color: '#cfe6f2', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false,
});

/** Assign UVs from world X/Z so textures tile continuously across separate meshes. */
export function worldUV(geo: THREE.BufferGeometry, ox = 0, oz = 0) {
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) + ox;
    uv[i * 2 + 1] = -(pos.getZ(i) + oz);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

const ROOFS: Record<'clay' | 'slate' | 'metal', { paint: Painter; size: number; roughness: number; metalness: number; photo: number }> = {
  clay: {
    size: 1.2, roughness: 0.75, metalness: 0, photo: 2.5,
    paint: (ctx, n) => {
      const r = rng(31);
      const rows = 6, h = n / rows, cols = 5, w = n / cols;
      for (let row = 0; row < rows; row++) {
        for (let c = -1; c <= cols; c++) {
          const t = (r() - 0.5) * 30;
          ctx.fillStyle = `rgb(${172 + t},${86 + t * 0.6},${58 + t * 0.4})`;
          const x = c * w + (row % 2 ? w / 2 : 0);
          ctx.fillRect(x + 1, row * h, w - 2, h);
          const g = ctx.createLinearGradient(0, row * h, 0, row * h + h);
          g.addColorStop(0, 'rgba(0,0,0,0)');
          g.addColorStop(1, 'rgba(0,0,0,0.28)');
          ctx.fillStyle = g;
          ctx.fillRect(x + 1, row * h, w - 2, h);
        }
      }
      noise(ctx, n, 12, 32);
    },
  },
  slate: {
    size: 1.0, roughness: 0.6, metalness: 0.05, photo: 3.0,
    paint: (ctx, n) => {
      const r = rng(41);
      const rows = 8, h = n / rows, cols = 6, w = n / cols;
      ctx.fillStyle = '#2a2d31';
      ctx.fillRect(0, 0, n, n);
      for (let row = 0; row < rows; row++) {
        for (let c = -1; c <= cols; c++) {
          const t = (r() - 0.5) * 18;
          ctx.fillStyle = `rgb(${68 + t},${73 + t},${80 + t})`;
          const x = c * w + (row % 2 ? w / 2 : 0);
          ctx.fillRect(x + 1.5, row * h + 1.5, w - 3, h - 2);
        }
      }
      noise(ctx, n, 10, 42);
    },
  },
  metal: {
    size: 1.0, roughness: 0.35, metalness: 0.55, photo: 1.12,
    paint: (ctx, n) => {
      ctx.fillStyle = '#5d646b';
      ctx.fillRect(0, 0, n, n);
      const seams = 4;
      for (let i = 0; i < seams; i++) {
        const x = (i * n) / seams;
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(x, 0, 3, n);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(x + 3, 0, 2, n);
      }
      noise(ctx, n, 6, 52);
    },
  },
};

const roofCache = new Map<string, THREE.MeshStandardMaterial>();
/** Roof covering; UVs are in metres (u along the eaves, v up the slope). */
export function roofMaterial(kind: 'clay' | 'slate' | 'metal'): THREE.MeshStandardMaterial {
  let m = roofCache.get(kind);
  if (!m) {
    const p = ROOFS[kind];
    const map = canvasTexture(p.paint);
    map.repeat.set(1 / p.size, 1 / p.size);
    m = pbr(new THREE.MeshStandardMaterial({ map, roughness: p.roughness, metalness: p.metalness, side: THREE.DoubleSide }),
      { name: `roof_${kind}`, maps: 'cnr', size: p.photo });
    roofCache.set(kind, m);
  }
  return m;
}


// ------------------------------------------------------- furniture finishes
// Detail textures are neutral grey, so the item's colour tints them.

const finishCache = new Map<string, THREE.MeshStandardMaterial>();
function cached<T extends THREE.MeshStandardMaterial>(key: string, make: () => T): T {
  let m = finishCache.get(key);
  if (!m) { m = make(); finishCache.set(key, m); }
  return m as T;
}

/** Oiled wood with real grain, tinted by `color`. */
export function woodMaterial(color: string): THREE.MeshStandardMaterial {
  // Pale woods use a softer grain; dark grain lines look dirty on birch or light oak.
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(color).getHSL(hsl, THREE.SRGBColorSpace);
  const spec: PbrSpec = hsl.l > 0.55
    ? { name: 'wood_soft', maps: 'c', size: 1.2, normalFrom: 'wood', normalScale: 0.4 }
    : { name: 'wood', maps: 'cnr', size: 1.2, normalScale: 0.6 };
  return cached(`wood|${color}`, () => pbr(new THREE.MeshStandardMaterial({ color, roughness: 0.6 }), spec));
}

/** Smooth painted or lacquered surface (white wardrobes, kitchen fronts). */
export function paintedMaterial(color: string, roughness = 0.42): THREE.MeshPhysicalMaterial {
  return cached(`paint|${color}|${roughness}`, () => effects(new THREE.MeshPhysicalMaterial({ color, roughness, clearcoat: 0.25, clearcoatRoughness: 0.5 })));
}

/** Woven upholstery with a soft sheen at grazing angles. */
export function fabricMaterial(color: string): THREE.MeshPhysicalMaterial {
  return cached(`fabric|${color}`, () => {
    const sheen = new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.35);
    return pbr(effects(new THREE.MeshPhysicalMaterial({ color, roughness: 0.95, sheen: 0.6, sheenRoughness: 0.7, sheenColor: sheen })),
      { name: 'fabric', maps: 'cnr', size: 0.5, normalScale: 0.8 });
  });
}

/** Rugs and carpets: deep pile. */
export function rugMaterial(color: string): THREE.MeshStandardMaterial {
  return cached(`rug|${color}`, () => pbr(new THREE.MeshStandardMaterial({ color, roughness: 1 }),
    { name: 'rug', maps: 'c', size: 0.6, normalFrom: 'floor_carpet' }));
}

/** Glazed ceramic or enamel (toilets, basins, baths). */
export function ceramicMaterial(color: string): THREE.MeshPhysicalMaterial {
  return cached(`ceramic|${color}`, () => effects(new THREE.MeshPhysicalMaterial({ color, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 })));
}

/** Brushed or polished metal. */
export function metalMaterial(color: string, roughness = 0.35): THREE.MeshStandardMaterial {
  return cached(`metal|${color}|${roughness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness: 1 }));
}

/**
 * Ceilings only face the floor, so direct light never reaches them. A little
 * emission stands in for light bounced off the floor and walls (daytime only).
 */
export const ceilingMaterial = new THREE.MeshStandardMaterial({ color: '#f5f3ef', roughness: 0.95, emissive: '#f5f3ef', emissiveIntensity: 0.3 });

/** Leather: fine grain and a soft waxed sheen. */
export function leatherMaterial(color: string): THREE.MeshPhysicalMaterial {
  return cached(`leather|${color}`, () => pbr(effects(new THREE.MeshPhysicalMaterial({ color, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.45 })),
    { name: 'leather', maps: 'cnr', size: 0.4, normalScale: 0.7 }));
}

/** Velvet: woven texture with a strong sheen. */
export function velvetMaterial(color: string): THREE.MeshPhysicalMaterial {
  return cached(`velvet|${color}`, () => {
    const sheen = new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.5);
    return pbr(effects(new THREE.MeshPhysicalMaterial({ color, roughness: 1, sheen: 1, sheenRoughness: 0.35, sheenColor: sheen })),
      { name: 'fabric', maps: 'cn', size: 0.3, normalScale: 0.4 });
  });
}

/** Polished stone such as marble or terrazzo worktops. */
export function stoneMaterial(color: string): THREE.MeshPhysicalMaterial {
  return cached(`stone|${color}`, () => pbr(effects(new THREE.MeshPhysicalMaterial({ color, roughness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.15 })),
    { name: 'floor_marble', maps: 'c', size: 1.2 }));
}

/** Clear or tinted glass (table tops, cabinet doors). */
export function glassFinish(color: string): THREE.MeshStandardMaterial {
  return cached(`glass|${color}`, () => new THREE.MeshStandardMaterial({
    color, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35, depthWrite: false,
  }));
}

/** Material for a finish, tinted by `color`. */
export function finishMaterial(finish: Finish, color: string): THREE.Material {
  switch (finish) {
    case 'wood': return woodMaterial(color);
    case 'painted': return paintedMaterial(color);
    case 'fabric': return fabricMaterial(color);
    case 'velvet': return velvetMaterial(color);
    case 'leather': return leatherMaterial(color);
    case 'metal': return metalMaterial(color, 0.35);
    case 'stone': return stoneMaterial(color);
    case 'glass': return glassFinish(color);
    case 'plastic': return paintedMaterial(color, 0.35);
  }
}
