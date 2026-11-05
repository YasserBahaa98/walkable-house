import type { Store } from '../model/store';
import type { Item, Level, Project, Tool, Vec2 } from '../model/types';
import { emptyProject, sampleProject } from '../model/sample';
import { parseProject } from '../model/validate';
import { formatLength, parseLength } from '../model/units';
import { uid } from '../model/ids';
import { dist } from '../geometry/math';
import { PlanView } from '../view2d/PlanView';
import { View3D } from '../view3d/View3D';
import { ModelLibrary } from '../view3d/models';
import { download, h, icon, iconButton, pickFile, slug } from './dom';
import type { IconName } from './icons';
import { busy, confirmDialog, dialog, promptDialog, toast } from './feedback';
import { Panel } from './Panel';

const TOOLS: { id: Tool; label: string; icon: IconName; key: string; hint: string }[] = [
  { id: 'select', label: 'Select & move', icon: 'select', key: 'V', hint: 'Click to select · drag to move · drag empty space to pan · double-click a room to walk there' },
  { id: 'wall', label: 'Draw walls', icon: 'wall', key: 'W', hint: 'Click to start, click to add corners · double-click, Enter or right-click to finish · Esc cancels' },
  { id: 'door', label: 'Place door', icon: 'door', key: 'D', hint: 'Click on a wall to place a door' },
  { id: 'window', label: 'Place window', icon: 'window', key: 'N', hint: 'Click on a wall to place a window' },
  { id: 'room', label: 'Detect room', icon: 'room', key: 'R', hint: 'Click inside an area enclosed by walls to create a room' },
  { id: 'stair', label: 'Place stairs', icon: 'stairs', key: 'S', hint: 'Click to place stairs leading up to the next level' },
  { id: 'measure', label: 'Measure', icon: 'ruler', key: 'M', hint: 'Drag to measure a distance · snaps to wall corners' },
];

const FILE_ACCEPT = '.dwg,.dxf,.json,.walkhouse,.png,.jpg,.jpeg,.webp,.glb,.gltf';

export class App {
  private plan!: PlanView;
  private view3d: View3D | null = null;
  private panel!: Panel;
  private library = new ModelLibrary();
  private root: HTMLElement;
  private els: Record<string, HTMLElement> = {};

  constructor(private store: Store, mount: HTMLElement) {
    this.root = mount;
    this.build();
    this.bindShortcuts();
    this.bindDrop();
    store.subscribe((k) => {
      if (k.has('project') || k.has('level') || k.has('tool') || k.has('view') || k.has('status')) this.refreshChrome();
    });
    this.refreshChrome();
  }

  // ---------------------------------------------------------------- layout
  private build() {
    const s = this.store;
    // Top bar
    const nameInput = h('input', { class: 'project-name', 'aria-label': 'Project name', maxlength: 80 });
    nameInput.addEventListener('change', () => s.mutate((p) => { p.name = nameInput.value.trim() || p.name; }));
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.blur(); });
    this.els.name = nameInput;
    this.els.layouts = h('div', { class: 'layout-chips', role: 'tablist', 'aria-label': 'Furniture layouts' });
    this.els.undo = iconButton('undo', 'Undo', () => s.undo(), 'Ctrl+Z');
    this.els.redo = iconButton('redo', 'Redo', () => s.redo(), 'Ctrl+Shift+Z');
    this.els.status = h('span', { class: 'save-status', 'aria-live': 'polite' });

    const topbar = h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, icon('house', 18)), h('span', { class: 'brand-name' }, 'Walkable House')),
      nameInput,
      this.els.layouts,
      h('div', { class: 'spacer' }),
      this.els.status,
      this.els.undo, this.els.redo,
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => this.openFile(), title: 'Import a DWG, DXF, image, project or 3D model (or drop a file anywhere)' }, icon('upload', 16), h('span', { class: 'hide-sm' }, 'Import')),
      this.menuButton('Export', 'download', [
        { label: 'Project file (.json)', icon: 'file', run: () => this.exportProject() },
        { label: '3D model (.glb)', icon: 'box', run: () => this.exportGlb() },
        { label: 'Screenshot of 3D view (.png)', icon: 'camera', run: () => this.screenshot() },
        { label: 'Plan image (.png)', icon: 'image', run: () => this.exportPlanPng() },
      ]),
      this.menuButton('', 'menu', [
        { label: 'New empty project', icon: 'plus', run: () => this.newProject(false) },
        { label: 'Load demo house', icon: 'house', run: () => this.newProject(true) },
        { label: 'Keyboard shortcuts & help', icon: 'help', run: () => this.help() },
      ], 'More'),
    );

    // Plan pane
    this.els.levels = h('div', { class: 'level-tabs', role: 'tablist', 'aria-label': 'Levels' });
    const toolbar = h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Drawing tools', 'aria-orientation': 'vertical' });
    for (const t of TOOLS) {
      const b = iconButton(t.icon, t.label, () => s.setTool(t.id), t.key, { 'data-tool': t.id, 'aria-pressed': 'false' });
      toolbar.append(b);
    }
    toolbar.append(h('div', { class: 'toolbar-sep' }),
      iconButton('zoomIn', 'Zoom in', () => this.plan.zoomBy(1.25), '+'),
      iconButton('zoomOut', 'Zoom out', () => this.plan.zoomBy(0.8), '−'),
      iconButton('frame', 'Fit plan to view', () => this.plan.fit(), 'F'));
    this.els.toolbar = toolbar;
    this.els.toolOptions = h('div', { class: 'tool-options' });
    this.els.statusbar = h('div', { class: 'statusbar' });
    const planHost = h('div', { class: 'plan-host' });
    const planPane = h('section', { class: 'pane plan-pane', 'aria-label': 'Floor plan' },
      h('div', { class: 'pane-head' }, this.els.levels,
        iconButton('plus', 'Add level above', () => this.addLevelQuick(), undefined, { class: 'icon-btn small' })),
      h('div', { class: 'plan-body' }, toolbar, planHost, this.els.toolOptions),
      this.els.statusbar);

    // 3D pane
    this.els.modeSeg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Camera mode' },
      h('button', { type: 'button', role: 'radio', 'data-mode': 'orbit', onclick: () => s.setView({ mode: 'orbit' }) }, icon('orbit', 16), 'Orbit'),
      h('button', { type: 'button', role: 'radio', 'data-mode': 'walk', onclick: () => this.walk() }, icon('walk', 16), 'Walk'));
    this.els.night = iconButton('moon', 'Toggle day / evening', () => s.setView({ night: !s.view.night }), 'L');
    const viewHost = h('div', { class: 'view-host' });
    const viewPane = h('section', { class: 'pane view-pane', 'aria-label': '3D view' },
      h('div', { class: 'pane-head' }, this.els.modeSeg, h('div', { class: 'spacer' }),
        this.els.night,
        iconButton('frame', 'Frame the house', () => { s.setView({ mode: 'orbit' }); this.view3d?.frame(); }),
        iconButton('camera', 'Save screenshot', () => this.screenshot())),
      viewHost);

    const splitter = h('div', { class: 'splitter', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize plan and 3D view', tabindex: 0 });
    this.panel = new Panel(s, this.library, { viewCenter: () => this.plan.viewCenter(), startCalibrate: () => this.startCalibrate() });

    this.els.workspace = h('main', { class: 'workspace' }, planPane, splitter, viewPane, this.panel.el);
    const mobileTabs = h('nav', { class: 'mobile-tabs', 'aria-label': 'Views' },
      ...(['plan', 'view', 'panel'] as const).map((p) => h('button', {
        type: 'button', 'data-pane': p, onclick: () => this.showMobilePane(p),
      }, icon(p === 'plan' ? 'grid' : p === 'view' ? 'box' : 'edit', 18), p === 'plan' ? 'Plan' : p === 'view' ? '3D' : 'Edit')));
    this.els.mobileTabs = mobileTabs;
    this.root.replaceChildren(topbar, this.els.workspace, mobileTabs);
    this.showMobilePane('plan');
    this.bindSplitter(splitter);

    this.plan = new PlanView(planHost, s, {
      toast,
      teleport: (x, z) => this.walk({ x, z }),
      calibrate: (a, b) => this.calibrate(a, b),
    });
    try {
      this.view3d = new View3D(viewHost, s, this.library);
      this.view3d.onPose = (p) => { this.plan.pose = p; this.plan.invalidate(); };
    } catch (err) {
      console.error(err);
      viewHost.append(h('div', { class: 'empty-state' }, icon('warning', 28),
        h('h3', {}, '3D view unavailable'),
        h('p', {}, 'Your browser or device could not start WebGL. The plan editor still works; try another browser or enable hardware acceleration.')));
    }
  }

  private menuButton(label: string, ic: IconName, items: { label: string; icon: IconName; run: () => void }[], aria?: string): HTMLElement {
    const menu = h('div', { class: 'menu', role: 'menu', hidden: true });
    const btn = h('button', {
      class: label ? 'btn btn-ghost' : 'icon-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': aria ?? label,
      title: aria ?? label,
    }, icon(ic, label ? 16 : 18), label ? h('span', { class: 'hide-sm' }, label) : null);
    const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside); };
    const outside = (e: PointerEvent) => { if (!wrap.contains(e.target as Node)) close(); };
    btn.addEventListener('click', () => {
      const open = menu.hidden;
      menu.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open) { document.addEventListener('pointerdown', outside); (menu.querySelector('button') as HTMLElement | null)?.focus(); } else close();
    });
    menu.addEventListener('keydown', (e) => {
      const buttons = [...menu.querySelectorAll('button')];
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'Escape') { close(); btn.focus(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus(); }
    });
    for (const it of items) {
      menu.append(h('button', { type: 'button', role: 'menuitem', class: 'menu-item', onclick: () => { close(); it.run(); } }, icon(it.icon, 16), it.label));
    }
    const wrap = h('div', { class: 'menu-wrap' }, btn, menu);
    return wrap;
  }

  private bindSplitter(el: HTMLElement) {
    const ws = this.els.workspace;
    const set = (frac: number) => {
      const f = Math.min(0.75, Math.max(0.25, frac));
      ws.style.setProperty('--plan-frac', String(f));
      try { localStorage.setItem('wh:split', String(f)); } catch { /* ignore */ }
    };
    try { const saved = parseFloat(localStorage.getItem('wh:split') ?? ''); if (saved) set(saved); } catch { /* ignore */ }
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      const rect = ws.getBoundingClientRect();
      const panelW = this.panel.el.getBoundingClientRect().width;
      const move = (ev: PointerEvent) => set((ev.clientX - rect.left) / (rect.width - panelW));
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
    el.addEventListener('keydown', (e) => {
      const cur = parseFloat(getComputedStyle(ws).getPropertyValue('--plan-frac')) || 0.5;
      if (e.key === 'ArrowLeft') set(cur - 0.05);
      if (e.key === 'ArrowRight') set(cur + 0.05);
    });
  }

  private showMobilePane(p: 'plan' | 'view' | 'panel') {
    this.els.workspace.dataset.mobile = p;
    this.els.mobileTabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.pane === p)));
  }

  /** Update toolbar state, level tabs, layouts and status after any change. */
  private refreshChrome() {
    const s = this.store;
    const name = this.els.name as HTMLInputElement;
    if (document.activeElement !== name) name.value = s.project.name;
    document.title = `${s.project.name} · Walkable House`;
    (this.els.undo as HTMLButtonElement).disabled = !s.canUndo;
    (this.els.redo as HTMLButtonElement).disabled = !s.canRedo;
    this.els.status.textContent = s.saveStatus === 'saving' ? 'Saving…' : s.saveStatus === 'error' ? 'Not saved' : 'Saved';
    this.els.status.className = `save-status ${s.saveStatus}`;
    this.els.status.title = s.saveStatus === 'error' ? 'Could not save to browser storage. Export the project to keep your work.' : 'Saved in this browser';

    this.els.toolbar.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => {
      const on = b.dataset.tool === s.tool;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    this.els.modeSeg.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
      const on = b.dataset.mode === s.view.mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    this.els.night.replaceChildren(icon(s.view.night ? 'sun' : 'moon'));

    // Level tabs, top level first like a building section.
    this.els.levels.replaceChildren(...[...s.sortedLevels()].reverse().map((l) => h('button', {
      type: 'button', role: 'tab', class: `level-tab${l.id === s.activeLevelId ? ' on' : ''}`, 'aria-selected': String(l.id === s.activeLevelId),
      onclick: () => s.setLevel(l.id), title: `${l.name} · ${formatLength(l.elevation, s.view.units)}`,
    }, l.name)));

    // Layout chips
    const layouts = s.project.layouts;
    this.els.layouts.replaceChildren(
      ...layouts.map((l) => h('button', {
        type: 'button', role: 'tab', class: `chip${l.id === s.project.activeLayoutId ? ' on' : ''}`, 'aria-selected': String(l.id === s.project.activeLayoutId),
        onclick: () => s.switchLayout(l.id), title: 'Switch furniture layout',
      }, l.name)),
      h('button', {
        type: 'button', class: 'chip chip-add', title: 'Save the current furniture as a layout to compare alternatives',
        onclick: async () => { const n = await promptDialog('Save layout', 'Layout name', `Layout ${String.fromCharCode(65 + layouts.length)}`); if (n) s.saveLayout(n); },
      }, icon('plus', 14), layouts.length ? '' : h('span', { class: 'hide-sm' }, 'Save layout')),
    );

    // Tool options + hint
    const tool = TOOLS.find((t) => t.id === s.tool)!;
    this.els.statusbar.textContent = s.view.mode === 'walk' && s.tool === 'select' ? 'Walking — the pink marker shows where you are. Double-click the plan to jump.' : tool.hint;
    this.renderToolOptions();
  }

  private renderToolOptions() {
    const s = this.store;
    const box = this.els.toolOptions;
    const prefs = this.plan?.prefs;
    if (!prefs) return;
    const lengthInput = (label: string, get: () => number, set: (v: number) => void) => {
      const input = h('input', { class: 'input input-sm', value: String(formatLength(get(), s.view.units)), 'aria-label': label });
      input.addEventListener('change', () => {
        const v = parseLength(input.value, s.view.units);
        if (v && v > 0.02 && v < 5) set(v);
        input.value = formatLength(get(), s.view.units);
      });
      return h('label', { class: 'tool-option' }, h('span', {}, label), input);
    };
    if (s.tool === 'wall') box.replaceChildren(lengthInput('Thickness', () => prefs.wallThickness, (v) => { prefs.wallThickness = v; }));
    else if (s.tool === 'door') box.replaceChildren(lengthInput('Width', () => prefs.doorWidth, (v) => { prefs.doorWidth = v; }));
    else if (s.tool === 'window') box.replaceChildren(lengthInput('Width', () => prefs.windowWidth, (v) => { prefs.windowWidth = v; }));
    else box.replaceChildren();
    box.hidden = !box.childElementCount;
  }

  // ------------------------------------------------------------- shortcuts
  private bindShortcuts() {
    const s = this.store;
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      const typing = /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (document.querySelector('dialog[open]')) return;
      if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); s.redo(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); this.exportProject(); return; }
      if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); this.openFile(); return; }
      if (mod && e.key.toLowerCase() === 'd' && !typing) { e.preventDefault(); s.duplicateSelection(); return; }
      if (typing || mod || e.altKey) return;
      const walking = s.view.mode === 'walk';
      if (e.key === 'Escape') {
        if (this.plan.cancel()) return;
        if (s.tool !== 'select') { s.setTool('select'); return; }
        if (s.selection) { s.select(null); return; }
        if (walking) s.setView({ mode: 'orbit' });
        return;
      }
      if (e.key === 'Enter' && s.tool === 'wall') { this.plan.finishDraft(); return; }
      if (e.key === ' ' && !walking) { this.plan.setSpace(true); if (t === this.plan.canvas) e.preventDefault(); return; }
      if (walking && ['w', 'a', 's', 'd'].includes(e.key.toLowerCase())) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection) { e.preventDefault(); s.deleteSelection(); return; }
      if (e.key === '?') { this.help(); return; }
      if (e.key === '1') { s.setView({ mode: 'orbit' }); return; }
      if (e.key === '2') { this.walk(); return; }
      if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        const next = e.key === 'PageUp' ? s.levelAbove() : s.levelBelow();
        if (next) s.setLevel(next.id);
        return;
      }
      const tool = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (tool && !walking) { s.setTool(tool.id); return; }
      if (e.key.toLowerCase() === 'f') { this.plan.fit(); this.view3d?.frame(); return; }
      if (e.key.toLowerCase() === 'l') { s.setView({ night: !s.view.night }); return; }
      if (e.key === '+' || e.key === '=') { this.plan.zoomBy(1.25); return; }
      if (e.key === '-') { this.plan.zoomBy(0.8); return; }
      const sel = s.selection;
      if (sel && (sel.kind === 'item' || sel.kind === 'stair')) {
        if (e.key.toLowerCase() === 'q' || e.key.toLowerCase() === 'e') {
          const step = (e.shiftKey ? Math.PI / 2 : Math.PI / 12) * (e.key.toLowerCase() === 'q' ? 1 : -1);
          s.mutate((_p, l) => {
            const obj = (sel.kind === 'item' ? l.items : l.stairs).find((x) => x.id === sel.id);
            if (obj) obj.rot = Math.round((obj.rot + step) * 1000) / 1000;
          }, `rot-${sel.id}`);
          return;
        }
        const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        const a = arrows[e.key];
        if (a && document.activeElement !== this.view3d?.renderer.domElement) {
          e.preventDefault();
          const d = e.shiftKey ? 0.5 : 0.05;
          s.mutate((_p, l) => {
            const obj = (sel.kind === 'item' ? l.items : l.stairs).find((x) => x.id === sel.id);
            if (obj) { obj.x = Math.round((obj.x + a[0] * d) * 1000) / 1000; obj.z = Math.round((obj.z + a[1] * d) * 1000) / 1000; }
          }, `nudge-${sel.id}`);
        }
      }
    });
    window.addEventListener('keyup', (e) => { if (e.key === ' ') this.plan.setSpace(false); });
  }

  // ---------------------------------------------------------------- files
  private bindDrop() {
    let depth = 0;
    const overlay = h('div', { class: 'drop-overlay', hidden: true }, h('div', {}, icon('upload', 32), h('p', {}, 'Drop a DWG, DXF, image, project or GLB file')));
    document.body.append(overlay);
    window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { depth++; overlay.hidden = false; } });
    window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) overlay.hidden = true; });
    window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      overlay.hidden = true;
      const f = e.dataTransfer?.files?.[0];
      if (f) void this.importFile(f);
    });
  }

  async openFile() {
    const f = await pickFile(FILE_ACCEPT);
    if (f) await this.importFile(f);
  }

  /** Route a file to the right importer based on its extension. */
  async importFile(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    try {
      if (ext === 'dwg' || ext === 'dxf') await this.importCad(file);
      else if (ext === 'json' || ext === 'walkhouse') await this.importProject(file);
      else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) await this.importImage(file);
      else if (ext === 'glb' || ext === 'gltf') await this.importModel(file);
      else toast(`Unsupported file type “.${ext}”. Use DWG, DXF, PNG/JPG, JSON or GLB.`, 'error');
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
    const c = this.plan.viewCenter();
    this.store.mutate((p) => {
      p.underlays[level.id] = {
        kind: 'image', dataUrl, width: img.naturalWidth, height: img.naturalHeight, scale,
        x: Math.round((c.x - width / 2) * 100) / 100, z: Math.round((c.z - (img.naturalHeight * scale) / 2) * 100) / 100,
      };
    });
    this.store.setView({ showUnderlay: true });
    this.plan.fit();
    this.store.setTool('wall');
    toast('Image placed under the plan. Trace walls with the wall tool (W); use Calibrate in the Inspect tab for exact scale.', 'success', 7000);
  }

  private async importModel(file: File) {
    const info = await this.library.importFile(file);
    const c = this.plan.viewCenter();
    const dim = (v: number) => Math.min(20, Math.max(0.05, Math.round(v * 1000) / 1000));
    const it: Item = { id: uid('i'), type: 'model', name: info.name, x: c.x, z: c.z, rot: 0, w: dim(info.size.x), d: dim(info.size.z), h: dim(info.size.y), color: '#c4bdb3', modelId: info.id };
    this.store.mutate((_p, l) => { l.items.push(it); });
    this.store.select({ kind: 'item', id: it.id });
    toast(`Added model “${info.name}”. It is saved in your library.`, 'success');
  }

  private afterLoad() {
    requestAnimationFrame(() => { this.plan.fit(); this.view3d?.frame(); });
  }

  // -------------------------------------------------------------- actions
  private walk(at?: { x: number; z: number }) {
    if (!this.view3d) { toast('The 3D view is not available on this device.', 'error'); return; }
    this.view3d.startWalk(at);
    if (matchMedia('(max-width: 900px)').matches) this.showMobilePane('view');
  }

  private addLevelQuick() {
    const s = this.store;
    const top = s.sortedLevels().at(-1)!;
    const id = uid('L');
    s.mutate((p) => {
      p.levels.push({ id, name: `Level ${p.levels.length + 1}`, elevation: Math.round((top.elevation + top.height + 0.3) * 1000) / 1000, height: top.height, walls: [], openings: [], rooms: [], items: [], stairs: [] });
    });
    s.setLevel(id);
  }

  private startCalibrate() {
    this.store.setTool('calibrate');
    this.els.statusbar.textContent = 'Calibrate: click the two ends of something whose real length you know (e.g. a wall).';
    toast('Click two points on the plan whose real distance you know.');
  }

  private async calibrate(a: Vec2, b: Vec2) {
    const measured = dist(a, b);
    if (measured < 0.01) { toast('The two points are too close together.', 'error'); return; }
    const s = this.store;
    const answer = await promptDialog('Calibrate scale', `Measured ${formatLength(measured, s.view.units)}. What is the real length?`, formatLength(measured, s.view.units),
      'Everything on this level (and its reference drawing) is scaled around the first point.');
    if (!answer) return;
    const real = parseLength(answer, s.view.units);
    if (!real || real <= 0) { toast('Please enter a valid length.', 'error'); return; }
    const k = real / measured;
    if (Math.abs(k - 1) < 1e-4) return;
    const level = s.level;
    s.mutate((p, l) => scaleLevel(p, l, a, k));
    void level;
    toast(`Scaled by ×${k.toFixed(3)}.`, 'success');
    this.plan.fit();
  }

  private exportProject() {
    const data = JSON.stringify(this.store.project);
    download(new Blob([data], { type: 'application/json' }), `${slug(this.store.project.name)}.walkhouse.json`);
    toast('Project file downloaded.', 'success');
  }

  private async exportGlb() {
    if (!this.view3d) return;
    const done = busy('Preparing 3D model…');
    try {
      const blob = await this.view3d.exportGLB();
      download(blob, `${slug(this.store.project.name)}.glb`);
      toast('3D model downloaded — open it in Blender, SketchUp or any glTF viewer.', 'success');
    } catch (err) {
      toast(`Export failed: ${err instanceof Error ? err.message : err}`, 'error');
    } finally {
      done();
    }
  }

  private screenshot() {
    if (!this.view3d) return;
    download(this.view3d.screenshot(), `${slug(this.store.project.name)}-3d.png`);
  }

  private exportPlanPng() {
    download(this.plan.canvas.toDataURL('image/png'), `${slug(this.store.project.name)}-${slug(this.store.level.name)}-plan.png`);
  }

  private async newProject(demo: boolean) {
    if (!(await confirmDialog(demo ? 'Load demo house' : 'New project', 'Replace the current project? You can undo this, or export it first.', demo ? 'Load demo' : 'Create'))) return;
    this.store.load(demo ? sampleProject() : emptyProject(), true);
    this.afterLoad();
    if (!demo) this.store.setTool('wall');
  }

  help() {
    const rows: [string, string][] = [
      ['V W D N R S M', 'Select, wall, door, window, room, stairs, measure'],
      ['Esc', 'Cancel / deselect / leave walk mode'],
      ['Delete', 'Delete selection'],
      ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
      ['Ctrl+D', 'Duplicate furniture or stairs'],
      ['Q / E (Shift = 90°)', 'Rotate selected furniture'],
      ['Arrow keys (Shift = 50 cm)', 'Nudge selected furniture'],
      ['Space + drag, wheel', 'Pan and zoom the plan'],
      ['F', 'Fit plan and 3D view'],
      ['1 / 2', 'Orbit / walk camera'],
      ['W A S D, Shift', 'Walk, run (after clicking the 3D view)'],
      ['PageUp / PageDown', 'Switch level'],
      ['L', 'Toggle day / evening'],
      ['Ctrl+S / Ctrl+O', 'Save project file / open file'],
    ];
    const body = h('div', { class: 'help' },
      h('h3', {}, 'Get started'),
      h('ol', {},
        h('li', {}, h('b', {}, 'Import your plan: '), 'drop a DWG or DXF file — walls, doors, windows, rooms, stairs and furniture are detected. Images can be traced.'),
        h('li', {}, h('b', {}, 'Fix and furnish: '), 'edit anything in the plan or the Inspect tab; add furniture from the Library.'),
        h('li', {}, h('b', {}, 'Walk through: '), 'press Walk (or double-click a room) and use W A S D. Stairs take you between levels.'),
        h('li', {}, h('b', {}, 'Check and share: '), 'the Report tab lists room areas and problems; export a GLB, screenshot or project file.')),
      h('h3', {}, 'Keyboard shortcuts'),
      h('table', { class: 'table' }, h('tbody', {}, ...rows.map(([k, v]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, v))))),
      h('p', { class: 'muted small' }, 'Your work is saved automatically in this browser and the app works offline once loaded. Install it from the browser menu to use it like a desktop app.'));
    void dialog({ title: 'Walkable House', body, actions: [{ label: 'Close', value: 'ok', primary: true }] });
  }

  /** First-run welcome with the three ways to begin. */
  async welcome() {
    const body = h('div', { class: 'welcome' },
      h('p', {}, 'Turn house plans into an editable 3D home you can walk through. Everything runs in your browser — nothing is uploaded.'),
      h('div', { class: 'welcome-options' },
        h('div', { class: 'welcome-card' }, icon('upload', 22), h('b', {}, 'Import a plan'), h('span', {}, 'DWG, DXF or an image')),
        h('div', { class: 'welcome-card' }, icon('house', 22), h('b', {}, 'Explore the demo'), h('span', {}, 'A furnished two-storey house')),
        h('div', { class: 'welcome-card' }, icon('wall', 22), h('b', {}, 'Start from scratch'), h('span', {}, 'Draw walls yourself'))));
    const r = await dialog({
      title: 'Welcome to Walkable House', body,
      actions: [{ label: 'Start empty', value: 'empty' }, { label: 'Explore demo', value: 'demo' }, { label: 'Import a plan…', value: 'import', primary: true }],
    });
    if (r === 'empty') { this.store.load(emptyProject()); this.store.setTool('wall'); this.afterLoad(); }
    if (r === 'import') await this.openFile();
  }
}

/** Scale a level's geometry (and reference drawing) uniformly around point `o`. */
export function scaleLevel(p: Project, l: Level, o: Vec2, k: number) {
  const sp = (q: Vec2): Vec2 => ({ x: Math.round((o.x + (q.x - o.x) * k) * 1000) / 1000, z: Math.round((o.z + (q.z - o.z) * k) * 1000) / 1000 });
  for (const w of l.walls) { w.a = sp(w.a); w.b = sp(w.b); }
  for (const op of l.openings) { op.offset *= k; op.width *= k; }
  for (const r of l.rooms) r.seed = sp(r.seed);
  for (const it of l.items) { const q = sp(it); it.x = q.x; it.z = q.z; }
  for (const s of l.stairs) { const q = sp(s); s.x = q.x; s.z = q.z; s.length *= k; s.width *= k; }
  const ul = p.underlays[l.id];
  if (ul?.kind === 'cad') {
    for (let i = 0; i < ul.segments.length; i += 2) {
      const q = sp({ x: ul.segments[i], z: ul.segments[i + 1] });
      ul.segments[i] = q.x; ul.segments[i + 1] = q.z;
    }
  } else if (ul?.kind === 'image') {
    const q = sp({ x: ul.x, z: ul.z });
    ul.x = q.x; ul.z = q.z; ul.scale *= k;
  }
}
