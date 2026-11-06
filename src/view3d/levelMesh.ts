import * as THREE from 'three';
import type { Item, Level, Opening, Stair, Wall } from '../model/types';
import type { Obb } from '../geometry/math';
import { cutHoles } from '../geometry/holes';
import { roomRegions, type Rect } from '../geometry/rooms';
import { stairFootprint, stairSections } from '../geometry/stairs';
import { endExtensions, openingSpans, wallPieces } from '../geometry/walls';
import { buildFurniture } from './furniture';
import { buildRoof } from './roofMesh';
import { mergeByMaterial } from './merge';
import { floorMaterial, glassMaterial, solid, wallMaterial, worldUV } from './materials';

export interface Pickable { kind: 'wall' | 'opening' | 'room' | 'item' | 'stair'; id: string; levelId: string }

export interface LevelBuildOptions {
  /** Height walls are rendered at (reaches the slab above for lower levels). */
  wallHeight: number;
  /** Cap wall height (cutaway view). */
  cutaway: number | null;
  doorsOpen: number;
  ceiling: boolean;
  /** Show this level's roof (if it has one). */
  roof: boolean;
  /** Stairwell holes cut into this level's slab (stairs from the level below). */
  holes: Obb[];
  /** Resolve an imported model for "model" items (null while loading/missing). */
  model: (id: string) => THREE.Object3D | null;
  shadows: boolean;
}

const SLAB = 0.2;
const FRAME = '#ffffff';
const DOOR = '#d8cfc4';

/** Static geometry of a level (everything except furniture, which is managed per item). */
export function buildLevel(level: Level, opt: LevelBuildOptions): THREE.Group {
  const root = new THREE.Group();
  root.name = `level:${level.id}`;
  root.position.y = level.elevation;
  const pick = (o: THREE.Object3D, kind: Pickable['kind'], id: string) => {
    o.userData.pick = { kind, id, levelId: level.id } satisfies Pickable;
  };

  const walls = new THREE.Group();
  walls.name = 'walls';
  const ext = endExtensions(level.walls);
  const h = opt.cutaway !== null ? Math.min(opt.cutaway, opt.wallHeight) : opt.wallHeight;
  for (const w of level.walls) {
    const g = buildWall(w, level.openings, w.height ?? h, ext.get(w.id) ?? [0, 0], opt);
    pick(g, 'wall', w.id);
    walls.add(g);
  }
  root.add(walls);

  // Floors per enclosed room.
  const floors = new THREE.Group();
  floors.name = 'floors';
  const regions = roomRegions(level);
  for (const r of level.rooms) {
    const reg = regions.get(r.id);
    if (!reg?.enclosed || !reg.rects.length) continue;
    const rects = cutHoles(reg.rects, opt.holes);
    if (!rects.length) continue;
    const mesh = new THREE.Mesh(rectsGeometry(rects, 0.004), floorMaterial(r.floor));
    mesh.receiveShadow = true;
    pick(mesh, 'room', r.id);
    floors.add(mesh);
  }
  root.add(floors);

  // Structural slab under the whole level (with stairwell holes).
  const bounds = slabBounds(level);
  if (bounds) {
    const rects = cutHoles([boundsRect(bounds)], opt.holes);
    const slab = new THREE.Mesh(slabGeometry(rects, -SLAB, 0), solid('#d4cfc7', 0.95));
    slab.receiveShadow = true;
    slab.castShadow = true;
    slab.name = 'slab';
    root.add(slab);
    if (opt.ceiling) {
      const ceil = new THREE.Mesh(slabGeometry(cutHoles([boundsRect(bounds)], level.stairs.flatMap(stairFootprint)), opt.wallHeight, opt.wallHeight + 0.15), solid('#f5f3ef', 0.95));
      ceil.name = 'ceiling';
      ceil.receiveShadow = true;
      root.add(ceil);
    }
  }

  if (opt.roof) {
    const roof = buildRoof(level, opt.wallHeight);
    if (roof) root.add(roof);
  }

  const stairs = new THREE.Group();
  for (const s of level.stairs) {
    const g = buildStair(s, opt.wallHeight + SLAB);
    pick(g, 'stair', s.id);
    stairs.add(g);
  }
  root.add(stairs);

  root.traverse((o) => {
    if (o instanceof THREE.Mesh && !opt.shadows) { o.castShadow = false; o.receiveShadow = false; }
  });
  mergeByMaterial(root);
  return root;
}

export function buildItem(it: Item, opt: Pick<LevelBuildOptions, 'model'>, levelId: string): THREE.Group {
  const g = new THREE.Group();
  let body: THREE.Object3D | null = null;
  if (it.type === 'model' && it.modelId) {
    const unit = opt.model(it.modelId);
    if (unit) {
      body = unit.clone(true);
      body.scale.set(it.w, it.h, it.d);
    }
  }
  if (body) g.add(body);
  else {
    const f = buildFurniture(it);
    mergeByMaterial(f, false);
    g.add(f);
  }
  g.position.set(it.x, it.elevation ?? 0, it.z);
  g.rotation.y = it.rot;
  g.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.pick = { kind: 'item', id: it.id, levelId } satisfies Pickable;
  return g;
}

function buildWall(w: Wall, openings: Opening[], height: number, ext: [number, number], opt: LevelBuildOptions): THREE.Group {
  const g = new THREE.Group();
  g.position.set(w.a.x, 0, w.a.z);
  g.rotation.y = -Math.atan2(w.b.z - w.a.z, w.b.x - w.a.x);
  const mat = wallMaterial(w.color);
  const t = w.thickness;
  for (const p of wallPieces(w, openings, height, ext)) {
    const len = p.to - p.from, ph = p.top - p.bottom;
    if (len <= 1e-4 || ph <= 1e-4) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, ph, t), mat);
    m.position.set((p.from + p.to) / 2, p.bottom + ph / 2, 0);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  for (const s of openingSpans(w, openings)) {
    const o = s.opening;
    const top = Math.min(o.sill + o.height, height);
    if (top <= o.sill + 0.05) continue;
    const og = new THREE.Group();
    if (o.kind === 'door') buildDoor(og, s.from, s.to, top, t, o, opt.doorsOpen);
    else if (o.kind === 'window') buildWindow(og, s.from, s.to, o.sill, top, t);
    og.traverse((c) => { c.userData.opening = o.id; });
    g.add(og);
  }
  return g;
}

function frameBox(g: THREE.Group, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
}

function buildDoor(g: THREE.Group, from: number, to: number, top: number, t: number, o: Opening, open: number) {
  const frame = solid(FRAME, 0.5);
  const fw = 0.05, fd = t + 0.02;
  frameBox(g, frame, fw, top, fd, from + fw / 2, 0, 0);
  frameBox(g, frame, fw, top, fd, to - fw / 2, 0, 0);
  frameBox(g, frame, to - from, fw, fd, (from + to) / 2, top - fw, 0);

  const width = to - from - fw * 2;
  if (width < 0.2) return;
  const left = (o.swing ?? 'left') === 'left';
  const leafT = 0.04;
  // Wide doorways get two leaves hinged on either side.
  const leaves: { hingeStart: boolean; w: number }[] = width > 1.25
    ? [{ hingeStart: true, w: width / 2 }, { hingeStart: false, w: width / 2 }]
    : [{ hingeStart: (o.hinge ?? 'start') === 'start', w: width }];
  for (const lf of leaves) {
    const pivot = new THREE.Group();
    pivot.position.set(lf.hingeStart ? from + fw : to - fw, 0, (left ? -1 : 1) * (t / 2 - leafT / 2));
    const leaf = new THREE.Group();
    const dir = lf.hingeStart ? 1 : -1;
    frameBox(leaf, solid(DOOR, 0.55), lf.w - 0.004, top - fw - 0.01, leafT, (dir * lf.w) / 2, 0.005, 0);
    const handle = solid('#3b3d40', 0.3, 0.8);
    for (const side of [-1, 1]) frameBox(leaf, handle, 0.12, 0.02, 0.02, dir * (lf.w - 0.12), 1.0, side * 0.035);
    pivot.add(leaf);
    pivot.rotation.y = dir * (left ? 1 : -1) * open * (Math.PI / 2) * 0.95;
    g.add(pivot);
  }
}

function buildWindow(g: THREE.Group, from: number, to: number, sill: number, top: number, t: number) {
  const frame = solid(FRAME, 0.45);
  const fw = 0.05, fd = Math.min(t, 0.08);
  const w = to - from;
  frameBox(g, frame, fw, top - sill, fd, from + fw / 2, sill, 0);
  frameBox(g, frame, fw, top - sill, fd, to - fw / 2, sill, 0);
  frameBox(g, frame, w, fw, fd, (from + to) / 2, sill, 0);
  frameBox(g, frame, w, fw, fd, (from + to) / 2, top - fw, 0);
  const panes = w > 1.3 ? Math.round(w / 0.9) : 1;
  for (let i = 1; i < panes; i++) frameBox(g, frame, 0.04, top - sill, fd, from + (w * i) / panes, sill, 0);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(w - fw * 2, top - sill - fw * 2, 0.012), glassMaterial);
  glass.position.set((from + to) / 2, (sill + top) / 2, 0);
  glass.renderOrder = 2;
  g.add(glass);
  if (sill > 0.1) frameBox(g, solid('#e9e6e0', 0.5), w + 0.06, 0.03, t + 0.08, (from + to) / 2, sill - 0.03, 0);
}

function buildStair(s: Stair, rise: number): THREE.Group {
  const g = new THREE.Group();
  const mat = solid('#b38d66', 0.6);
  const side = solid('#efebe5', 0.85);
  const railMat = solid('#2f3134', 0.35, 0.7);
  const box = (parent: THREE.Object3D, m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) => {
    if (w <= 0 || h <= 0 || d <= 0) return;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
  };
  for (const sec of stairSections(s, rise)) {
    const sg = new THREE.Group();
    sg.position.set(sec.obb.cx, 0, sec.obb.cz);
    sg.rotation.y = sec.obb.rot;
    const w = sec.obb.hx * 2, len = sec.obb.hz * 2;
    if (sec.kind === 'landing') {
      box(sg, side, w, sec.y0 - 0.04, len, 0, (sec.y0 - 0.04) / 2, 0);
      box(sg, mat, w, 0.04, len, 0, sec.y0 - 0.02, 0);
    } else {
      const n = Math.max(1, sec.steps);
      const tread = len / n, riser = (sec.y1 - sec.y0) / n;
      for (let k = 0; k < n; k++) {
        const y = sec.y0 + (k + 1) * riser;
        const z = -len / 2 + tread * (k + 0.5);
        box(sg, mat, w, 0.04, tread + 0.02, 0, y - 0.02, z);
        box(sg, side, w, y - 0.04, tread, 0, (y - 0.04) / 2, z);
      }
      // Handrail on the flight's +X side.
      const h = sec.y1 - sec.y0;
      const railLen = Math.hypot(len, h);
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, railLen, 8), railMat);
      rail.position.set(w / 2 - 0.04, sec.y0 + h / 2 + 0.9, 0);
      rail.rotation.x = Math.atan2(len, h);
      sg.add(rail);
      for (const f of [0.05, 0.5, 0.95]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 6), railMat);
        post.position.set(w / 2 - 0.04, sec.y0 + h * f + 0.45, -len / 2 + len * f);
        sg.add(post);
      }
    }
    g.add(sg);
  }
  return g;
}

/** Upward-facing quads for each rectangle, with world-space UVs. */
function rectsGeometry(rects: Rect[], y: number): THREE.BufferGeometry {
  const pos = new Float32Array(rects.length * 18);
  rects.forEach((r, i) => {
    const x0 = r.x, x1 = r.x + r.w, z0 = r.z, z1 = r.z + r.d;
    pos.set([x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0], i * 18);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  worldUV(geo);
  return geo;
}

function slabGeometry(rects: Rect[], y0: number, y1: number): THREE.BufferGeometry {
  const geos = rects.map((r) => {
    const b = new THREE.BoxGeometry(r.w, y1 - y0, r.d);
    b.translate(r.x + r.w / 2, (y0 + y1) / 2, r.z + r.d / 2);
    return b;
  });
  const merged = mergeBoxes(geos);
  geos.forEach((g) => g.dispose());
  return merged;
}

function mergeBoxes(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  if (!geos.length) return out;
  let vCount = 0, iCount = 0;
  for (const g of geos) { vCount += g.getAttribute('position').count; iCount += g.getIndex()!.count; }
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), u = g.getAttribute('uv'), ix = g.getIndex()!;
    pos.set(p.array as Float32Array, vo * 3);
    nor.set(n.array as Float32Array, vo * 3);
    uv.set(u.array as Float32Array, vo * 2);
    for (let k = 0; k < ix.count; k++) idx[io + k] = ix.getX(k) + vo;
    vo += p.count; io += ix.count;
  }
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

interface SB { minX: number; minZ: number; maxX: number; maxZ: number }
function slabBounds(level: Level): SB | null {
  if (!level.walls.length) return null;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const w of level.walls) {
    const p = w.thickness / 2;
    for (const q of [w.a, w.b]) {
      minX = Math.min(minX, q.x - p); maxX = Math.max(maxX, q.x + p);
      minZ = Math.min(minZ, q.z - p); maxZ = Math.max(maxZ, q.z + p);
    }
  }
  return { minX, minZ, maxX, maxZ };
}

const boundsRect = (b: SB): Rect => ({ x: b.minX, z: b.minZ, w: b.maxX - b.minX, d: b.maxZ - b.minZ });
