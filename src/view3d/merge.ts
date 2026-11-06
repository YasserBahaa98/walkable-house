import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Pickable } from './levelMesh';

/** Which original object a range of triangles in a merged mesh came from. */
export interface PickRange { start: number; end: number; pick: Pickable | null; opening?: string }

/** Local bounds of a pickable object (relative to the merged root), for selection outlines. */
export interface PickBox { box: THREE.Box3; matrix: THREE.Matrix4 }

const ATTRS = ['position', 'normal', 'uv'] as const;

/**
 * Merge every mesh under `root` into one mesh per material (and shadow/render
 * settings). This turns hundreds of small meshes into a handful of draw calls.
 * Picking is preserved through triangle ranges, and outlines through bounds.
 */
export function mergeByMaterial(root: THREE.Object3D, keepPicking = true): void {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const buckets = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; order: number; geos: THREE.BufferGeometry[]; ranges: PickRange[]; tris: number }>();
  const boxes = new Map<string, PickBox>();
  const meshes: THREE.Mesh[] = [];
  let mergeable = true;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (Array.isArray(o.material) || o instanceof THREE.InstancedMesh || o instanceof THREE.SkinnedMesh) mergeable = false;
    else meshes.push(o);
  });
  if (!mergeable || meshes.length < 2) return;

  if (keepPicking) {
    // Bounds of each pickable object in root space, computed before merging.
    root.traverse((o) => {
      const pick = o.userData.pick as Pickable | undefined;
      const opening = o.userData.opening as string | undefined;
      const isOpeningRoot = opening && o.parent?.userData.opening !== opening;
      if (!pick && !isOpeningRoot) return;
      const key = pick ? `${pick.kind}:${pick.id}` : `opening:${opening}`;
      if (boxes.has(key)) return;
      const inv = o.matrixWorld.clone().invert();
      const box = new THREE.Box3();
      o.traverse((m) => {
        if (!(m instanceof THREE.Mesh)) return;
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        box.union(m.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)));
      });
      if (!box.isEmpty()) boxes.set(key, { box, matrix: new THREE.Matrix4().multiplyMatrices(toRoot, o.matrixWorld) });
    });
  }

  for (const m of meshes) {
    let pick: Pickable | null = null, opening: string | undefined;
    for (let o: THREE.Object3D | null = m; o && o !== root.parent; o = o.parent) {
      if (!opening && o.userData.opening) opening = o.userData.opening as string;
      if (!pick && o.userData.pick) pick = o.userData.pick as Pickable;
    }
    const mat = m.material as THREE.Material;
    const key = `${mat.uuid}|${m.castShadow}|${m.receiveShadow}|${m.renderOrder}`;
    let b = buckets.get(key);
    if (!b) {
      b = { material: mat, cast: m.castShadow, receive: m.receiveShadow, order: m.renderOrder, geos: [], ranges: [], tris: 0 };
      buckets.set(key, b);
    }
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!(ATTRS as readonly string[]).includes(name)) g.deleteAttribute(name);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    g = g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, m.matrixWorld));
    const tris = g.getAttribute('position').count / 3;
    b.ranges.push({ start: b.tris, end: b.tris + tris, pick, opening });
    b.tris += tris;
    b.geos.push(g);
  }

  // Replace the original hierarchy with the merged meshes.
  for (const child of [...root.children]) {
    root.remove(child);
    child.traverse((o) => { if (o instanceof THREE.Mesh && !o.geometry.userData.shared) o.geometry.dispose(); });
  }
  for (const b of buckets.values()) {
    const geo = mergeGeometries(b.geos, false);
    b.geos.forEach((g) => g.dispose());
    if (!geo) continue;
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, b.material);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    mesh.renderOrder = b.order;
    if (keepPicking) mesh.userData.pickRanges = b.ranges;
    root.add(mesh);
  }
  if (keepPicking) root.userData.pickBoxes = boxes;
}

/** Look up the original object for a hit on a merged mesh. */
export function pickFromRanges(ranges: PickRange[], faceIndex: number): PickRange | undefined {
  let lo = 0, hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid];
    if (faceIndex < r.start) hi = mid - 1;
    else if (faceIndex >= r.end) lo = mid + 1;
    else return r;
  }
  return undefined;
}
