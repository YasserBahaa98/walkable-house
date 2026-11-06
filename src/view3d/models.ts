import * as THREE from 'three';
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

  /** Validate, store and register a single .glb / .gltf / .zip file. */
  importFile(file: File): Promise<ModelInfo> {
    return this.importFiles([file]);
  }

  /**
   * Import a model from one or more files: a .glb, a .gltf with its .bin and
   * texture files, or a .zip containing either. Multi-file models are
   * converted to a single self-contained GLB before they are stored.
   */
  async importFiles(files: File[]): Promise<ModelInfo> {
    const total = files.reduce((n, f) => n + f.size, 0);
    if (total > MAX_BYTES) throw new Error('Model files are larger than 40 MB in total.');
    const entries: { name: string; data: Uint8Array }[] = [];
    for (const f of files) {
      const data = new Uint8Array(await f.arrayBuffer());
      if (/\.zip$/i.test(f.name)) {
        const { unzipSync } = await import('fflate');
        let unzipped: Record<string, Uint8Array>;
        try { unzipped = unzipSync(data); } catch (err) { throw new Error('This zip file could not be opened.', { cause: err }); }
        for (const [name, bytes] of Object.entries(unzipped)) {
          if (!name.endsWith('/') && !name.startsWith('__MACOSX')) entries.push({ name, data: bytes });
        }
      } else entries.push({ name: f.name, data });
    }
    const base = (n: string) => n.split('/').pop()!;
    const glb = entries.find((e) => /\.glb$/i.test(e.name));
    const gltf = entries.find((e) => /\.gltf$/i.test(e.name));
    if (!glb && !gltf) throw new Error('No .glb or .gltf model found. Select the model file (and its .bin/texture files), or a .zip.');
    const name = base((glb ?? gltf)!.name).replace(/\.(glb|gltf)$/i, '');
    let data: ArrayBuffer;
    if (glb && !gltf) {
      data = glb.data.slice().buffer;
    } else {
      data = await this.packGltf(gltf!, entries);
    }
    const stored: StoredModel = { id: uid('m'), name, data, createdAt: Date.now() };
    const info = await this.parse(stored);
    stored.size = { x: info.size.x, y: info.size.y, z: info.size.z };
    await putModel(stored);
    return info;
  }

  /** Load a .gltf whose resources are among `entries`, then export it as one GLB. */
  private async packGltf(gltf: { name: string; data: Uint8Array }, entries: { name: string; data: Uint8Array }[]): Promise<ArrayBuffer> {
    const urls = new Map<string, string>();
    for (const e of entries) {
      if (e === gltf) continue;
      const url = URL.createObjectURL(new Blob([e.data.slice()]));
      urls.set(e.name.toLowerCase(), url);
      urls.set(e.name.split('/').pop()!.toLowerCase(), url);
    }
    const missing = new Set<string>();
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      if (/^(data|blob):/.test(url)) return url;
      const clean = decodeURIComponent(url.split(/[?#]/)[0]).replace(/^\.\//, '');
      const hit = urls.get(clean.toLowerCase()) ?? urls.get(clean.split('/').pop()!.toLowerCase());
      if (!hit) missing.add(clean.split('/').pop()!);
      return hit ?? url;
    });
    try {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const loader = new GLTFLoader(manager);
      let result;
      try {
        result = await loader.parseAsync(new TextDecoder().decode(gltf.data), '');
      } catch (err) {
        if (missing.size) throw new Error(`Missing files: ${[...missing].join(', ')}. Select them together with the .gltf, or import the .zip.`, { cause: err });
        throw new Error(`Could not read this model: ${err instanceof Error ? err.message : 'invalid glTF'}.`, { cause: err });
      }
      if (missing.size) throw new Error(`Missing files: ${[...missing].join(', ')}. Select them together with the .gltf, or import the .zip.`);
      const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
      return (await new GLTFExporter().parseAsync(result.scene, { binary: true })) as ArrayBuffer;
    } finally {
      urls.forEach((u) => URL.revokeObjectURL(u));
    }
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
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      gltf = await new GLTFLoader().parseAsync(m.data.slice(0), '');
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
