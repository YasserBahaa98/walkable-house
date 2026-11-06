import * as THREE from 'three';
import type { FloorMaterial } from '../model/types';

// Procedural textures keep the app fully offline and tiny. Each texture is
// drawn once on a canvas and tiled in world space (1 texture repeat = `size` m).

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

const PAINTERS: Record<FloorMaterial, { paint: Painter; size: number; roughness: number }> = {
  oak: { paint: planks([196, 160, 118], 26, 7), size: 2.4, roughness: 0.62 },
  walnut: { paint: planks([118, 82, 56], 22, 11), size: 2.4, roughness: 0.55 },
  tile: {
    size: 1.2, roughness: 0.35,
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
    size: 1.6, roughness: 0.18,
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
    size: 1.0, roughness: 0.95,
    paint: (ctx, n) => {
      ctx.fillStyle = '#b9b0a4';
      ctx.fillRect(0, 0, n, n);
      noise(ctx, n, 34, 21);
    },
  },
  concrete: {
    size: 3.0, roughness: 0.85,
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
    m = new THREE.MeshStandardMaterial({ map, roughness: p.roughness, metalness: 0 });
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
export function plasterTexture(): THREE.CanvasTexture {
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
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, bumpMap: bump, bumpScale: 0.4 });
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
    grass = new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0 });
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

const ROOFS: Record<'clay' | 'slate' | 'metal', { paint: Painter; size: number; roughness: number; metalness: number }> = {
  clay: {
    size: 1.2, roughness: 0.75, metalness: 0,
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
    size: 1.0, roughness: 0.6, metalness: 0.05,
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
    size: 1.0, roughness: 0.35, metalness: 0.55,
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
    m = new THREE.MeshStandardMaterial({ map, roughness: p.roughness, metalness: p.metalness, side: THREE.DoubleSide });
    roofCache.set(kind, m);
  }
  return m;
}
