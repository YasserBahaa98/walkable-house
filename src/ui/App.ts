import type { Store } from '../model/store';
import type { Vec2 } from '../model/types';
import { emptyProject, sampleProject } from '../model/sample';
import { formatLength, parseLength } from '../model/units';
import { uid } from '../model/ids';
import { dist } from '../geometry/math';
import { scaleLevel } from '../geometry/transform';
import { PlanView } from '../view2d/PlanView';
import { View3D } from '../view3d/View3D';
import { ModelLibrary } from '../view3d/models';
import { download, h, icon, iconButton, slug } from './dom';
import type { IconName } from './icons';
import { busy, confirmDialog, dialog, promptDialog, toast } from './feedback';
import { Panel } from './Panel';
import { FileImporter } from './FileImporter';
import { bindShortcuts } from './shortcuts';
import { TOOLS } from './tools';



export class App {
  private plan!: PlanView;
  private view3d: View3D | null = null;
  private panel!: Panel;
  private library = new ModelLibrary();
  private files!: FileImporter;
  private root: HTMLElement;
  private els: Record<string, HTMLElement> = {};
  private levelsSig = '';
  private layoutsSig = '';
  private toolOptionsSig = '';

  constructor(private store: Store, mount: HTMLElement) {
    this.root = mount;
    this.build();
    bindShortcuts({
      store, plan: this.plan, view3d: () => this.view3d,
      help: () => this.help(), walk: () => this.walk(), exportProject: () => this.exportProject(), openFile: () => this.openFile(),
    });
    this.files = new FileImporter(store, this.library, {
      viewCenter: () => this.plan.viewCenter(),
      fit: () => this.plan.fit(),
      frame: () => this.view3d?.frame(),
    });
    this.files.bindDrop();
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
    this.els.roof = iconButton('house', 'Show roof', () => s.setView({ showRoof: !s.view.showRoof }), 'T', { 'aria-pressed': 'false' });
    const viewHost = h('div', { class: 'view-host' });
    const viewPane = h('section', { class: 'pane view-pane', 'aria-label': '3D view' },
      h('div', { class: 'pane-head' }, this.els.modeSeg, h('div', { class: 'spacer' }),
        this.els.roof, this.els.night,
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
    this.els.roof.setAttribute('aria-pressed', String(s.view.showRoof));
    this.els.roof.classList.toggle('on', s.view.showRoof);

    // Level tabs and layout chips: rebuilt only when their content changes (not on every drag step).
    const levelsSig = JSON.stringify([s.activeLevelId, s.view.units, s.project.levels.map((l) => [l.id, l.name, l.elevation])]);
    if (levelsSig !== this.levelsSig) {
      this.levelsSig = levelsSig;
      // Top level first, like a building section.
      this.els.levels.replaceChildren(...[...s.sortedLevels()].reverse().map((l) => h('button', {
        type: 'button', role: 'tab', class: `level-tab${l.id === s.activeLevelId ? ' on' : ''}`, 'aria-selected': String(l.id === s.activeLevelId),
        onclick: () => s.setLevel(l.id), title: `${l.name} · ${formatLength(l.elevation, s.view.units)}`,
      }, l.name)));
    }
    const layouts = s.project.layouts;
    const layoutsSig = JSON.stringify([s.project.activeLayoutId, layouts.map((l) => [l.id, l.name])]);
    if (layoutsSig !== this.layoutsSig) {
      this.layoutsSig = layoutsSig;
      this.els.layouts.replaceChildren(
        ...layouts.map((l) => h('button', {
          type: 'button', role: 'tab', class: `chip${l.id === s.project.activeLayoutId ? ' on' : ''}`, 'aria-selected': String(l.id === s.project.activeLayoutId),
          onclick: () => s.switchLayout(l.id), title: 'Switch furniture layout',
        }, l.name)),
        h('button', {
          type: 'button', class: 'chip chip-add', title: 'Save the current furniture as a layout to compare alternatives',
          onclick: async () => { const n = await promptDialog('Save layout', 'Layout name', `Layout ${String.fromCharCode(65 + s.project.layouts.length)}`); if (n) s.saveLayout(n); },
        }, icon('plus', 14), layouts.length ? '' : h('span', { class: 'hide-sm' }, 'Save layout')),
      );
    }

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
    const sig = `${s.tool}|${s.view.units}`;
    if (sig === this.toolOptionsSig) return;
    this.toolOptionsSig = sig;
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

  // -------------------------------------------------------------- actions
  openFile() { return this.files.openFile(); }

  private afterLoad() { this.files.afterLoad(); }

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
      ['W A S D, ← →, Shift', 'Walk, turn, run (click the 3D view to look with the mouse; gamepads work too)'],
      ['PageUp / PageDown', 'Switch level'],
      ['L', 'Toggle day / evening'],
      ['T', 'Show / hide the roof in orbit view'],
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
