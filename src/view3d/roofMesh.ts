import * as THREE from 'three';
import type { Level } from '../model/types';
import { roofFaces, type V3, wallRect } from '../geometry/roof';
import { roofMaterial, wallMaterial } from './materials';

let gableMaterial: THREE.MeshStandardMaterial | null = null;

/** Build a fan-triangulated polygon with UVs in metres along its own plane. */
function polygonGeometry(polys: V3[][]): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [];
  for (const poly of polys) {
    const a = new THREE.Vector3(...poly[0]);
    const b = new THREE.Vector3(...poly[1]);
    const c = new THREE.Vector3(...poly[2]);
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    // u: horizontal direction along the first edge; v: up the slope.
    const uDir = new THREE.Vector3().subVectors(b, a).setY(0);
    if (uDir.lengthSq() < 1e-9) uDir.set(1, 0, 0);
    uDir.normalize();
    const vDir = new THREE.Vector3().crossVectors(normal, uDir).normalize();
    const uvOf = (p: V3) => {
      const v = new THREE.Vector3(...p);
      return [v.dot(uDir), v.dot(vDir)];
    };
    for (let i = 1; i < poly.length - 1; i++) {
      for (const p of [poly[0], poly[i], poly[i + 1]]) {
        pos.push(...p);
        uv.push(...uvOf(p));
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

/** Roof over a level whose walls are `wallHeight` tall (local to the level group). */
export function buildRoof(level: Level, wallHeight: number): THREE.Group | null {
  const rect = wallRect(level);
  if (!level.roof || !rect) return null;
  const faces = roofFaces(rect, wallHeight, level.roof);
  const g = new THREE.Group();
  g.name = 'roof';
  const slopes = new THREE.Mesh(polygonGeometry(faces.slopes), roofMaterial(level.roof.material));
  slopes.castShadow = slopes.receiveShadow = true;
  g.add(slopes);
  if (level.roof.type === 'flat') {
    // Give flat roofs a visible edge.
    const r = rect, o = level.roof.overhang;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(r.maxX - r.minX + o * 2, 0.18, r.maxZ - r.minZ + o * 2), wallMaterial('#d9d5ce'));
    slab.position.set((r.minX + r.maxX) / 2, wallHeight - 0.09, (r.minZ + r.maxZ) / 2);
    slab.castShadow = slab.receiveShadow = true;
    g.add(slab);
  }
  if (faces.gables.length) {
    gableMaterial ??= Object.assign(wallMaterial().clone(), { side: THREE.DoubleSide });
    const gm = gableMaterial;
    const gables = new THREE.Mesh(polygonGeometry(faces.gables), gm);
    gables.castShadow = gables.receiveShadow = true;
    g.add(gables);
  }
  return g;
}
