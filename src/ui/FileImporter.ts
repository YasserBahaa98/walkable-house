import type { Store } from '../model/store';
import type { Item, Project, Vec2 } from '../model/types';
import { parseProject } from '../model/validate';
import { parseLength } from '../model/units';
import { uid } from '../model/ids';
import type { ModelLibrary } from '../view3d/models';
import { h, icon, pickFiles } from './dom';
import { busy, confirmDialog, promptDialog, toast } from './feedback';

export const FILE_ACCEPT = '.dwg,.dxf,.json,.walkhouse,.png,.jpg,.jpeg,.webp,.glb,.gltf,.bin,.zip';

export interface ImportHost {
  viewCenter(): Vec2;
  fit(): void;
  frame(): void;
}

/** Routes files (picked, dropped or opened) to the right importer: CAD, project, image or 3D model. */
export class FileImporter {
  constructor(private store: Store, private library: ModelLibrary, private host: ImportHost) {}

  /** Accept files dropped anywhere on the page. */
  bindDrop() {
    let depth = 0;
    const overlay = h('div', { class: 'drop-overlay', hidden: true }, h('div', {}, icon('upload', 32), h('p', {}, 'Drop a DWG, DXF, image, project or 3D model')));
    document.body.append(overlay);
    window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { depth++; overlay.hidden = false; } });
    window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) overlay.hidden = true; });
    window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      overlay.hidden = true;
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) void this.importFiles(files);
    });
  }

  async openFile() {
    const files = await pickFiles(FILE_ACCEPT);
    if (files.length) await this.importFiles(files);
  }

  /** Several files at once are a multi-file 3D model (.gltf + .bin + textures). */
  async importFiles(files: File[]) {
    if (files.length === 1) return this.importFile(files[0]);
    if (files.some((f) => /\.(gltf|glb|zip)$/i.test(f.name))) {
      try { await this.importModel(files); } catch (err) { toast(err instanceof Error ? err.message : 'Import failed.', 'error'); }
      return;
    }
    toast('Import one plan at a time. Multiple files are only supported for a .gltf model with its .bin and textures.', 'error');
  }

  /** Route a file to the right importer based on its extension. */
  async importFile(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    try {
      if (ext === 'dwg' || ext === 'dxf') await this.importCad(file);
      else if (ext === 'json' || ext === 'walkhouse') await this.importProject(file);
      else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) await this.importImage(file);
      else if (ext === 'glb' || ext === 'gltf' || ext === 'zip') await this.importModel([file]);
      else toast(`Unsupported file type “.${ext}”. Use DWG, DXF, PNG/JPG, JSON, GLB/glTF or ZIP.`, 'error');
    } catch (err) {
      console.error(err);
      toast(err instanceof Error ? err.message : 'Import failed.', 'error');
    }
  }

  private async importCad(file: File) {
    if (file.size > 80 * 1024 * 1024) throw new Error('This drawing is larger than 80 MB.');
    const done = busy(`Reading ${file.name}…`);
    let drawing;
    try {
      const { readCadFile } = await import('../importer/cadClient');
      drawing = await readCadFile(file);
    } finally {
      done();
    }
    const { cadImportDialog } = await import('./importDialog');
    const hasContent = this.store.project.levels.some((l) => l.walls.length);
    const res = await cadImportDialog(drawing, hasContent);
    if (!res) return;
    if (res.mode === 'append') {
      const top = this.store.sortedLevels().at(-1)!;
      const base = top.elevation + top.height + 0.3;
      this.store.mutate((p) => {
        for (const l of res.project.levels) {
          l.elevation = Math.round((l.elevation + base) * 1000) / 1000;
          p.levels.push(l);
          const ul = res.project.underlays[l.id];
          if (ul) p.underlays[l.id] = ul;
        }
      });
      this.store.setLevel(res.project.levels[0].id);
    } else {
      this.store.load(res.project, true);
    }
    this.afterLoad();
    const rooms = res.project.levels.reduce((n, l) => n + l.rooms.length, 0);
    toast(`Imported ${res.project.levels.length} level${res.project.levels.length === 1 ? '' : 's'} and ${rooms} rooms. Check the Report tab for anything to fix.`, 'success', 6000);
  }

  private async importProject(file: File) {
    const text = await file.text();
    let project: Project;
    try {
      project = parseProject(JSON.parse(text));
    } catch (err) {
      throw new Error(err instanceof SyntaxError ? 'This file is not valid JSON.' : (err as Error).message, { cause: err });
    }
    if (!(await confirmDialog('Open project', `Replace the current project with “${project.name}”? You can undo this.`, 'Open'))) return;
    this.store.load(project, true);
    this.afterLoad();
    toast(`Opened “${project.name}”.`, 'success');
  }

  private async importImage(file: File) {
    if (file.size > 25 * 1024 * 1024) throw new Error('Image is larger than 25 MB.');
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('Could not read the image.'));
      r.readAsDataURL(file);
    });
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('This image could not be decoded.'));
      i.src = dataUrl;
    });
    const widthStr = await promptDialog('Trace over an image', 'How wide is the drawing in reality?', '12 m',
      'A rough estimate is fine — you can calibrate exactly afterwards by measuring a known wall.');
    if (!widthStr) return;
    const width = parseLength(widthStr, 'm') ?? 12;
    const level = this.store.level;
    const scale = width / img.naturalWidth;
    const c = this.host.viewCenter();
    this.store.mutate((p) => {
      p.underlays[level.id] = {
        kind: 'image', dataUrl, width: img.naturalWidth, height: img.naturalHeight, scale,
        x: Math.round((c.x - width / 2) * 100) / 100, z: Math.round((c.z - (img.naturalHeight * scale) / 2) * 100) / 100,
      };
    });
    this.store.setView({ showUnderlay: true });
    this.host.fit();
    this.store.setTool('wall');
    toast('Image placed under the plan. Trace walls with the wall tool (W); use Calibrate in the Inspect tab for exact scale.', 'success', 7000);
  }

  private async importModel(files: File[]) {
    const done = busy('Importing 3D model…');
    let info;
    try { info = await this.library.importFiles(files); } finally { done(); }
    const c = this.host.viewCenter();
    const dim = (v: number) => Math.min(20, Math.max(0.05, Math.round(v * 1000) / 1000));
    const it: Item = { id: uid('i'), type: 'model', name: info.name, x: c.x, z: c.z, rot: 0, w: dim(info.size.x), d: dim(info.size.z), h: dim(info.size.y), color: '#c4bdb3', modelId: info.id };
    this.store.mutate((_p, l) => { l.items.push(it); });
    this.store.select({ kind: 'item', id: it.id });
    toast(`Added model “${info.name}”. It is saved in your library.`, 'success');
  }

  /** Fit the views to freshly loaded content. */
  afterLoad() {
    requestAnimationFrame(() => { this.host.fit(); this.host.frame(); });
  }
}
