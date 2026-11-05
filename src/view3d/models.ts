import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { uid } from '../model/ids';
import { getModel, listModels, putModel, type StoredModel } from '../model/persistence';

export interface ModelInfo { id: string; name: string; size: THREE.Vector3 }

const MAX_BYTES = 40 * 1024 * 1024;

/**
 * Imported glTF/GLB furniture. Models are stored in IndexedDB and normalised
 * to a 1×1×1 box (bottom-centred) so items can scale them to any footprint.
 */
export class ModelLibrary {
  private units = new Map<string, THREE.Object3D>();
  private loading = new Map<string, Promise<void>>();
  private failed = new Set<string>();
  onLoaded: (id: string) => void = () => {};
  private loader = new GLTFLoader();

  /** Normalised model if ready; triggers a background load otherwise. */
  get(id: string): THREE.Object3D | null {
    const unit = this.units.get(id);
    if (unit) return unit;
    if (!this.loading.has(id) && !this.failed.has(id)) {
      this.loading.set(id, getModel(id)
        .then(async (m) => {
          if (!m) throw new Error('missing');
          await this.parse(m);
          this.onLoaded(id);
        })
        .catch(() => { this.failed.add(id); })
        .finally(() => this.loading.delete(id)));
    }
    return null;
  }

  /** Validate, store and register a .glb / self-contained .gltf file. */
  async importFile(file: File): Promise<ModelInfo> {
    if (file.size > MAX_BYTES) throw new Error('Model is larger than 40 MB.');
    const data = await file.arrayBuffer();
    const stored: StoredModel = { id: uid('m'), name: file.name.replace(/\.(glb|gltf)$/i, ''), data, createdAt: Date.now() };
    const info = await this.parse(stored);
    stored.size = { x: info.size.x, y: info.size.y, z: info.size.z };
    await putModel(stored);
    return info;
  }

  async list(): Promise<{ id: string; name: string; size?: { x: number; y: number; z: number } }[]> {
    try {
      return (await listModels()).sort((a, b) => a.createdAt - b.createdAt).map((m) => ({ id: m.id, name: m.name, size: m.size }));
    } catch {
      return [];
    }
  }

  private async parse(m: StoredModel): Promise<ModelInfo> {
    let gltf;
    try {
      gltf = await this.loader.parseAsync(m.data.slice(0), '');
    } catch (err) {
      throw new Error(`Could not read this model: ${err instanceof Error ? err.message : 'invalid glTF'}. Only .glb or self-contained .gltf files are supported.`, { cause: err });
    }
    const obj = gltf.scene;
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) throw new Error('The model contains no geometry.');
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    obj.position.set(-c.x, -box.min.y, -c.z);
    const scaler = new THREE.Group();
    scaler.add(obj);
    scaler.scale.set(1 / Math.max(size.x, 1e-6), 1 / Math.max(size.y, 1e-6), 1 / Math.max(size.z, 1e-6));
    const unit = new THREE.Group();
    unit.add(scaler);
    unit.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.units.set(m.id, unit);
    this.failed.delete(m.id);
    return { id: m.id, name: m.name, size };
  }
}
