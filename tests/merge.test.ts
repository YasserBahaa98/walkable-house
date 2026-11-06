import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mergeByMaterial, pickFromRanges, type PickBox, type PickRange } from '../src/view3d/merge';

describe('mergeByMaterial', () => {
  it('merges meshes per material and keeps picking and bounds', () => {
    const root = new THREE.Group();
    root.position.y = 3;
    const wallMat = new THREE.MeshStandardMaterial();
    const glass = new THREE.MeshStandardMaterial({ transparent: true });
    const wall = new THREE.Group();
    wall.userData.pick = { kind: 'wall', id: 'w1', levelId: 'L' };
    wall.position.set(2, 0, 0);
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.2), wallMat);
      m.position.x = i;
      wall.add(m);
    }
    const win = new THREE.Group();
    win.userData.opening = 'o1';
    win.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.01), glass));
    wall.add(win);
    root.add(wall);

    mergeByMaterial(root);
    const meshes = root.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    expect(meshes).toHaveLength(2);

    const wallMesh = meshes.find((m) => m.material === wallMat)!;
    const ranges = wallMesh.userData.pickRanges as PickRange[];
    expect(pickFromRanges(ranges, 0)?.pick?.id).toBe('w1');
    expect(pickFromRanges(ranges, 5 * 12 - 1)?.pick?.id).toBe('w1');
    expect(pickFromRanges(ranges, 5 * 12)).toBeUndefined();
    const glassMesh = meshes.find((m) => m.material === glass)!;
    expect(pickFromRanges(glassMesh.userData.pickRanges as PickRange[], 0)?.opening).toBe('o1');

    // Geometry is baked in root-local space (the root's own offset is not applied twice).
    wallMesh.geometry.computeBoundingBox();
    expect(wallMesh.geometry.boundingBox!.min.x).toBeCloseTo(1.5);
    expect(wallMesh.geometry.boundingBox!.min.y).toBeCloseTo(-1);

    const boxes = root.userData.pickBoxes as Map<string, PickBox>;
    expect(boxes.get('wall:w1')!.box.getSize(new THREE.Vector3()).x).toBeCloseTo(5);
    expect(boxes.has('opening:o1')).toBe(true);
  });

  it('leaves multi-material models untouched', () => {
    const root = new THREE.Group();
    const geo = new THREE.BoxGeometry();
    geo.addGroup(0, 18, 0);
    geo.addGroup(18, 18, 1);
    root.add(new THREE.Mesh(geo, [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()]));
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    mergeByMaterial(root);
    expect(root.children).toHaveLength(2);
  });
});
