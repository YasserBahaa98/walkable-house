import type { Store } from '../model/store';
import type { FloorMaterial, FurnitureType, Item, Level, Opening, Room, Stair, Units, Wall } from '../model/types';
import { CATALOG } from '../model/catalog';
import { uid } from '../model/ids';
import { formatArea, formatLength, parseLength, toUnit, unitLabel } from '../model/units';
import { checkLevel, type Issue } from '../geometry/checks';
import { roomRegions } from '../geometry/rooms';
import { stairRise, stepCount } from '../geometry/stairs';
import { splitWall, wallLength } from '../geometry/walls';
import { floorSwatch } from '../view3d/materials';
import type { ModelLibrary } from '../view3d/models';
import { download, h, icon, iconButton, pickFile, slug } from './dom';
import { confirmDialog, promptDialog, toast } from './feedback';

type Tab = 'inspect' | 'library' | 'report' | 'view';

const FLOORS: { id: FloorMaterial; label: string }[] = [
  { id: 'oak', label: 'Oak' }, { id: 'walnut', label: 'Walnut' }, { id: 'tile', label: 'Tile' },
  { id: 'marble', label: 'Marble' }, { id: 'carpet', label: 'Carpet' }, { id: 'concrete', label: 'Concrete' },
];

export interface PanelHost {
  viewCenter(): { x: number; z: number };
  startCalibrate(): void;
}

/** Right-hand panel: inspector, furniture library, report and view settings. */
export class Panel {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private tabs: Record<Tab, HTMLButtonElement>;
  private tab: Tab = 'inspect';
  private refreshers: (() => void)[] = [];
  private renderKey = '';
  private scheduled = false;
  private swatches = new Map<FloorMaterial, string>();
  private models: { id: string; name: string; size?: { x: number; y: number; z: number } }[] = [];

  constructor(private store: Store, private library: ModelLibrary, private host: PanelHost) {
    const mk = (id: Tab, label: string) => h('button', {
      class: 'tab', role: 'tab', id: `tab-${id}`, 'aria-controls': 'panel-body', type: 'button',
      onclick: () => this.setTab(id),
    }, label);
    this.tabs = { inspect: mk('inspect', 'Inspect'), library: mk('library', 'Library'), report: mk('report', 'Report'), view: mk('view', 'View') };
    this.body = h('div', { class: 'panel-body', id: 'panel-body', role: 'tabpanel' });
    this.el = h('aside', { class: 'panel', 'aria-label': 'Properties' },
      h('div', { class: 'tabs', role: 'tablist' }, ...Object.values(this.tabs)),
      this.body);
    store.subscribe(() => this.schedule());
    void library.list().then((m) => { this.models = m; this.schedule(true); });
    this.setTab('inspect');
  }

  setTab(t: Tab) {
    this.tab = t;
    for (const [id, b] of Object.entries(this.tabs)) {
      b.setAttribute('aria-selected', String(id === t));
      b.tabIndex = id === t ? 0 : -1;
    }
    this.schedule(true);
  }

  private schedule(force = false) {
    if (force) this.renderKey = '';
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => { this.scheduled = false; this.render(); });
  }

  /** Re-render when the structure changes; otherwise just refresh values (keeps focus while typing). */
  private render() {
    const s = this.store;
    const sel = s.selection;
    const key = [this.tab, s.activeLevelId, sel?.kind, sel?.id, s.view.units, s.project.levels.length,
      this.tab === 'report' || this.tab === 'view' || !sel ? JSON.stringify([s.project.levels.map((l) => [l.name, l.elevation, l.rooms.length, l.walls.length, l.items.length, l.stairs.length]), s.project.layouts.map((l) => l.name), s.project.activeLayoutId, s.view, Object.keys(s.project.underlays)]) : '',
      this.tab === 'report' ? JSON.stringify(s.project.levels.map((l) => [l.walls, l.openings, l.rooms, l.items])) : '',
      this.models.length,
    ].join('|');
    const active = document.activeElement;
    const typing = active instanceof HTMLElement && this.body.contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName);
    if (key === this.renderKey || (typing && this.renderKey.split('|').slice(0, 4).join('|') === key.split('|').slice(0, 4).join('|'))) {
      this.refreshers.forEach((r) => r());
      return;
    }
    this.renderKey = key;
    this.refreshers = [];
    const scroll = this.body.scrollTop;
    this.body.replaceChildren(...this.content());
    this.body.scrollTop = scroll;
  }

  private content(): Node[] {
    switch (this.tab) {
      case 'library': return this.libraryTab();
      case 'report': return this.reportTab();
      case 'view': return this.viewTab();
      default: return this.inspectTab();
    }
  }

  // ------------------------------------------------------------- inspect
  private inspectTab(): Node[] {
    const s = this.store;
    const sel = s.selection;
    const obj = s.find();
    if (!sel || !obj) return this.levelSection();
    switch (sel.kind) {
      case 'wall': return this.wallSection(obj as Wall);
      case 'opening': return this.openingSection(obj as Opening);
      case 'room': return this.roomSection(obj as Room);
      case 'item': return this.itemSection(obj as Item);
      case 'stair': return this.stairSection(obj as Stair);
    }
  }

  private levelSection(): Node[] {
    const s = this.store;
    const level = s.level;
    const ul = s.project.underlays[level.id];
    const regions = roomRegions(level);
    const area = level.rooms.reduce((sum, r) => sum + (regions.get(r.id)?.area ?? 0), 0);
    return [
      h('p', { class: 'hint' }, icon('info', 14), ' Select a wall, door, room, stair or piece of furniture in the plan or 3D view to edit it.'),
      section('Level', [
        this.textField('Name', () => level.name, (v) => s.mutate((_p, l) => { l.name = v || l.name; }, 'level-name')),
        this.lengthField('Floor elevation', () => level.elevation, (v) => s.mutate((_p, l) => { l.elevation = v; }, 'level-elev'), -50, 500),
        this.lengthField('Ceiling height', () => level.height, (v) => s.mutate((_p, l) => { l.height = v; }, 'level-height'), 1.8, 20),
        h('div', { class: 'stat-row' },
          stat('Rooms', String(level.rooms.length)), stat('Floor area', formatArea(area, s.view.units)), stat('Items', String(level.items.length))),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', type: 'button', onclick: () => this.addLevel() }, icon('plus', 16), 'Add level above'),
          h('button', { class: 'btn', type: 'button', onclick: () => this.duplicateLevel() }, icon('copy', 16), 'Duplicate'),
          h('button', { class: 'btn btn-danger-ghost', type: 'button', disabled: s.project.levels.length < 2, onclick: () => this.deleteLevel() }, icon('trash', 16), 'Delete'),
        ),
      ]),
      section('Reference drawing', ul ? [
        h('p', { class: 'muted small' }, ul.kind === 'cad' ? `CAD linework (${(ul.segments.length / 4).toLocaleString()} lines)` : 'Image underlay'),
        this.toggle('Show on plan', () => s.view.showUnderlay, (v) => s.setView({ showUnderlay: v })),
        this.slider('Opacity', 0.05, 1, 0.05, () => s.view.underlayOpacity, (v) => s.setView({ underlayOpacity: v }), (v) => `${Math.round(v * 100)}%`),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', type: 'button', onclick: () => this.host.startCalibrate() }, icon('target', 16), 'Calibrate scale'),
          h('button', { class: 'btn btn-danger-ghost', type: 'button', onclick: () => s.mutate((p) => { delete p.underlays[level.id]; }) }, icon('trash', 16), 'Remove')),
      ] : [h('p', { class: 'muted small' }, 'Import an image or CAD file to trace over it. Use Import in the top bar.')]),
    ];
  }

  private wallSection(w: Wall): Node[] {
    const s = this.store;
    const level = s.level;
    const len = wallLength(w);
    const edit = (fn: (x: Wall) => void, key: string) => s.mutate((_p, l) => { const x = l.walls.find((q) => q.id === w.id); if (x) fn(x); }, key);
    return [
      header('Wall', 'wall', () => s.deleteSelection()),
      section('Dimensions', [
        this.lengthField('Length', () => wallLength(this.cur<Wall>() ?? w), (v) => edit((x) => {
          const L = wallLength(x) || 1;
          x.b = { x: round(x.a.x + ((x.b.x - x.a.x) / L) * v), z: round(x.a.z + ((x.b.z - x.a.z) / L) * v) };
        }, `wall-len-${w.id}`), 0.1, 200),
        this.lengthField('Thickness', () => (this.cur<Wall>() ?? w).thickness, (v) => edit((x) => { x.thickness = v; }, `wall-t-${w.id}`), 0.03, 1.5),
        this.lengthField('Height', () => (this.cur<Wall>() ?? w).height ?? level.height, (v) => edit((x) => { x.height = Math.abs(v - level.height) < 1e-6 ? undefined : v; }, `wall-h-${w.id}`), 0.2, 20,
          'Leave equal to the level height to follow it.'),
        this.colorField('Paint', () => (this.cur<Wall>() ?? w).color ?? '#f2eee8', (v) => edit((x) => { x.color = v; }, `wall-c-${w.id}`)),
      ]),
      section('Actions', [
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', type: 'button', onclick: () => this.addOpeningAt(w, 'door') }, icon('door', 16), 'Add door'),
          h('button', { class: 'btn', type: 'button', onclick: () => this.addOpeningAt(w, 'window') }, icon('window', 16), 'Add window'),
          h('button', {
            class: 'btn', type: 'button', disabled: len < 0.3,
            onclick: () => { s.mutate((_p, l) => { splitWall(l, w.id, len / 2, () => uid('w')); }); s.select(null); toast('Wall split in two.'); },
          }, icon('flip', 16), 'Split'),
        ),
        h('p', { class: 'muted small' }, 'Tip: drag the square handles in the plan to move wall ends; connected walls follow.'),
      ]),
    ];
  }

  private openingSection(o: Opening): Node[] {
    const s = this.store;
    const edit = (fn: (x: Opening) => void, key: string) => s.mutate((_p, l) => { const x = l.openings.find((q) => q.id === o.id); if (x) fn(x); }, key);
    const cur = () => this.cur<Opening>() ?? o;
    const wall = s.wall(o.wallId);
    const kindSeg = segmented([{ id: 'door', label: 'Door' }, { id: 'window', label: 'Window' }, { id: 'opening', label: 'Passage' }], o.kind, (v) => edit((x) => {
      x.kind = v as Opening['kind'];
      if (v === 'window') { x.sill = x.sill || 0.9; x.height = Math.min(x.height, 1.4); } else { x.sill = 0; x.height = Math.max(x.height, 2.1); }
      if (v === 'door') { x.hinge ??= 'start'; x.swing ??= 'left'; }
    }, `op-kind-${o.id}-${uid()}`));
    const nodes: Node[] = [
      header(o.kind === 'door' ? 'Door' : o.kind === 'window' ? 'Window' : 'Passage', o.kind === 'window' ? 'window' : 'door', () => s.deleteSelection()),
      section('Type', [kindSeg]),
      section('Dimensions', [
        this.lengthField('Width', () => cur().width, (v) => edit((x) => { x.width = v; }, `op-w-${o.id}`), 0.2, wall ? wallLength(wall) : 20),
        this.lengthField('Height', () => cur().height, (v) => edit((x) => { x.height = v; }, `op-h-${o.id}`), 0.2, 10),
        o.kind === 'window' ? this.lengthField('Sill height', () => cur().sill, (v) => edit((x) => { x.sill = v; }, `op-s-${o.id}`), 0, 5) : null,
        this.lengthField('Position along wall', () => cur().offset, (v) => edit((x) => { x.offset = v; }, `op-o-${o.id}`), 0, wall ? wallLength(wall) : 100,
          'Distance from the wall start to the centre. You can also drag it in the plan.'),
      ].filter(Boolean) as Node[]),
    ];
    if (o.kind === 'door') {
      nodes.push(section('Swing', [h('div', { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', onclick: () => edit((x) => { x.hinge = x.hinge === 'end' ? 'start' : 'end'; }, uid()) }, icon('flip', 16), 'Flip hinge'),
        h('button', { class: 'btn', type: 'button', onclick: () => edit((x) => { x.swing = x.swing === 'right' ? 'left' : 'right'; }, uid()) }, icon('rotate', 16), 'Flip side'),
      )]));
    }
    return nodes;
  }

  private roomSection(r: Room): Node[] {
    const s = this.store;
    const reg = roomRegions(s.level).get(r.id);
    const edit = (fn: (x: Room) => void, key: string) => s.mutate((_p, l) => { const x = l.rooms.find((q) => q.id === r.id); if (x) fn(x); }, key);
    const grid = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Floor finish' });
    for (const f of FLOORS) {
      const b = h('button', {
        class: 'swatch', type: 'button', role: 'radio', 'aria-checked': String(r.floor === f.id), title: f.label,
        onclick: () => edit((x) => { x.floor = f.id; }, uid()),
      }, h('img', { src: this.swatch(f.id), alt: '' }), h('span', {}, f.label));
      grid.append(b);
    }
    return [
      this.liveHeader(() => (this.cur<Room>() ?? r).name, 'room', () => s.deleteSelection()),
      section('Details', [
        this.textField('Name', () => (this.cur<Room>() ?? r).name, (v) => edit((x) => { x.name = v || x.name; }, `room-n-${r.id}`)),
        h('div', { class: 'stat-row' },
          stat('Area', reg?.enclosed ? formatArea(reg.area, s.view.units) : '—'),
          stat('Status', reg?.enclosed ? 'Enclosed' : 'Open')),
        reg?.enclosed ? null : h('p', { class: 'warn small' }, icon('warning', 14), ' Walls do not fully enclose this room, so no floor is generated. Close gaps with walls (doors count as walls).'),
      ].filter(Boolean) as Node[]),
      section('Floor finish', [grid]),
    ];
  }

  private itemSection(it: Item): Node[] {
    const s = this.store;
    const edit = (fn: (x: Item) => void, key: string) => s.mutate((_p, l) => { const x = l.items.find((q) => q.id === it.id); if (x) fn(x); }, key);
    const cur = () => this.cur<Item>() ?? it;
    const types = [...new Set(CATALOG.map((c) => c.type))];
    if (it.type === 'model') types.push('model');
    const typeSel = h('select', { class: 'input', 'aria-label': 'Type' },
      ...types.map((t) => h('option', { value: t, selected: t === it.type }, cap(t))));
    typeSel.addEventListener('change', () => edit((x) => { x.type = typeSel.value as FurnitureType; }, uid()));
    return [
      this.liveHeader(() => cur().name, 'sofa', () => s.deleteSelection()),
      section('Details', [
        this.textField('Name', () => cur().name, (v) => edit((x) => { x.name = v || x.name; }, `it-n-${it.id}`)),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Type'), typeSel),
        this.colorField('Colour', () => cur().color, (v) => edit((x) => { x.color = v; }, `it-c-${it.id}`)),
      ]),
      section('Size', [
        h('div', { class: 'grid-3' },
          this.lengthField('Width', () => cur().w, (v) => edit((x) => { x.w = v; }, `it-w-${it.id}`), 0.02, 30),
          this.lengthField('Depth', () => cur().d, (v) => edit((x) => { x.d = v; }, `it-d-${it.id}`), 0.02, 30),
          this.lengthField('Height', () => cur().h, (v) => edit((x) => { x.h = v; }, `it-h-${it.id}`), 0.005, 10)),
        this.lengthField('Raised by', () => cur().elevation ?? 0, (v) => edit((x) => { x.elevation = v || undefined; }, `it-e-${it.id}`), 0, 10, 'For wall-mounted items such as TVs and shelves.'),
      ]),
      section('Placement', [
        h('div', { class: 'grid-2' },
          this.lengthField('X', () => cur().x, (v) => edit((x) => { x.x = v; }, `it-x-${it.id}`), -1000, 1000),
          this.lengthField('Y', () => cur().z, (v) => edit((x) => { x.z = v; }, `it-z-${it.id}`), -1000, 1000)),
        this.numberField('Rotation', '°', () => Math.round(((cur().rot * 180) / Math.PI) * 10) / 10, (v) => edit((x) => { x.rot = (v * Math.PI) / 180; }, `it-r-${it.id}`), -360, 360, 15),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', type: 'button', onclick: () => edit((x) => { x.rot = norm(x.rot + Math.PI / 2); }, uid()) }, icon('rotate', 16), 'Rotate 90°'),
          h('button', { class: 'btn', type: 'button', onclick: () => s.duplicateSelection() }, icon('copy', 16), 'Duplicate')),
      ]),
    ];
  }

  private stairSection(st: Stair): Node[] {
    const s = this.store;
    const edit = (fn: (x: Stair) => void, key: string) => s.mutate((_p, l) => { const x = l.stairs.find((q) => q.id === st.id); if (x) fn(x); }, key);
    const cur = () => this.cur<Stair>() ?? st;
    const above = s.levelAbove();
    const rise = stairRise(s.level, above);
    const n = stepCount(rise);
    return [
      header('Stairs', 'stairs', () => s.deleteSelection()),
      section('Shape', [
        segmented([{ id: 'straight', label: 'Straight' }, { id: 'L', label: 'L-shaped' }, { id: 'U', label: 'U-shaped' }], st.shape ?? 'straight',
          (v) => edit((x) => {
            if (v === 'straight') { delete x.shape; delete x.turn; delete x.length2; return; }
            x.shape = v as 'L' | 'U';
            x.turn ??= 'right';
            // Split the run so the total stays similar.
            if (!x.length2) {
              const total = x.length;
              x.length = Math.max(1, Math.round(total * 55) / 100);
              x.length2 = Math.max(0.8, Math.round((total - x.length) * 100) / 100);
            }
          }, uid())),
        st.shape ? segmented([{ id: 'left', label: 'Turns left' }, { id: 'right', label: 'Turns right' }], st.turn ?? 'right',
          (v) => edit((x) => { x.turn = v as 'left' | 'right'; }, uid())) : null,
      ].filter(Boolean) as Node[]),
      section('Dimensions', [
        h('div', { class: 'grid-2' },
          this.lengthField('Width', () => cur().width, (v) => edit((x) => { x.width = v; }, `st-w-${st.id}`), 0.5, 5),
          this.lengthField(st.shape ? 'First flight' : 'Run length', () => cur().length, (v) => edit((x) => { x.length = v; }, `st-l-${st.id}`), 0.5, 15)),
        st.shape ? this.lengthField('Second flight', () => cur().length2 ?? cur().length, (v) => edit((x) => { x.length2 = v; }, `st-l2-${st.id}`), 0.5, 15) : null,
        this.numberField('Rotation', '°', () => Math.round(((cur().rot * 180) / Math.PI) * 10) / 10, (v) => edit((x) => { x.rot = (v * Math.PI) / 180; }, `st-r-${st.id}`), -360, 360, 15),
        h('div', { class: 'stat-row' },
          stat('Rise', formatLength(rise, s.view.units)), stat('Steps', String(n)),
          stat('Riser', formatLength(rise / n, s.view.units, true)),
          stat('Tread', formatLength((cur().length + (cur().shape ? (cur().length2 ?? cur().length) : 0)) / n, s.view.units, true))),
        !above ? h('p', { class: 'warn small' }, icon('warning', 14), ' There is no level above, so these stairs lead nowhere yet.') : null,
        (cur().length + (cur().shape ? (cur().length2 ?? cur().length) : 0)) / n < 0.18
          ? h('p', { class: 'warn small' }, icon('warning', 14), ' Very steep: treads are shorter than 18 cm. Make the run longer or use an L/U shape.') : null,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', type: 'button', onclick: () => edit((x) => { x.rot = norm(x.rot + Math.PI); }, uid()) }, icon('flip', 16), 'Reverse direction'),
          h('button', { class: 'btn', type: 'button', onclick: () => edit((x) => { x.rot = norm(x.rot + Math.PI / 2); }, uid()) }, icon('rotate', 16), 'Rotate 90°'),
          h('button', { class: 'btn', type: 'button', onclick: () => s.duplicateSelection() }, icon('copy', 16), 'Duplicate')),
      ].filter(Boolean) as Node[]),
    ];
  }

  // ------------------------------------------------------------- library
  private libraryTab(): Node[] {
    const s = this.store;
    const cats = [...new Set(CATALOG.map((c) => c.category))];
    const nodes: Node[] = [h('p', { class: 'hint' }, icon('info', 14), ` Click to add to “${s.level.name}”. Items appear in the middle of the plan view.`)];
    for (const cat of cats) {
      nodes.push(section(cat, [h('div', { class: 'catalog' }, ...CATALOG.filter((c) => c.category === cat).map((c) =>
        h('button', {
          class: 'catalog-item', type: 'button', title: `${c.name} — ${formatLength(c.w, s.view.units)} × ${formatLength(c.d, s.view.units)}`,
          onclick: () => this.addItem({ type: c.type, name: c.name, w: c.w, d: c.d, h: c.h, color: c.color, ...(c.elevation ? { elevation: c.elevation } : {}) }),
        }, h('span', { class: 'catalog-dot', style: `background:${c.color}` }), h('span', {}, c.name))))]));
    }
    nodes.push(section('Structure', [h('div', { class: 'btn-row' },
      h('button', { class: 'btn', type: 'button', onclick: () => this.addStair() }, icon('stairs', 16), 'Add stairs'))]));
    nodes.push(section('Your 3D models', [
      h('p', { class: 'muted small' }, 'Import furniture as .glb (or self-contained .gltf). Models are stored in this browser and work offline.'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: () => this.importModel() }, icon('upload', 16), 'Import model…')),
      this.models.length ? h('div', { class: 'catalog' }, ...this.models.map((m) => h('button', {
        class: 'catalog-item', type: 'button', onclick: () => this.addModel(m.id, m.name),
      }, icon('box', 14), h('span', {}, m.name)))) : null,
    ].filter(Boolean) as Node[]));
    return nodes;
  }

  // -------------------------------------------------------------- report
  private reportTab(): Node[] {
    const s = this.store;
    const u = s.view.units;
    const issues: { level: Level; issue: Issue }[] = [];
    let total = 0;
    const tables: Node[] = [];
    for (const level of s.sortedLevels()) {
      const regions = roomRegions(level);
      const rows = level.rooms.map((r) => {
        const reg = regions.get(r.id);
        if (reg?.enclosed) total += reg.area;
        return h('tr', { class: 'clickable', onclick: () => { s.setLevel(level.id); s.select({ kind: 'room', id: r.id }); this.setTab('inspect'); } },
          h('td', {}, r.name), h('td', {}, cap(r.floor)), h('td', { class: 'num' }, reg?.enclosed ? formatArea(reg.area, u) : '—'));
      });
      const levelArea = level.rooms.reduce((sum, r) => sum + (regions.get(r.id)?.area ?? 0), 0);
      tables.push(h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('caption', {}, `${level.name} · ${formatArea(levelArea, u)}`),
        h('thead', {}, h('tr', {}, h('th', {}, 'Room'), h('th', {}, 'Floor'), h('th', { class: 'num' }, 'Area'))),
        h('tbody', {}, ...(rows.length ? rows : [h('tr', {}, h('td', { colspan: 3, class: 'muted' }, 'No rooms yet — use the Room tool (R).'))])))));
      for (const issue of checkLevel(level)) issues.push({ level, issue });
    }
    const walls = s.project.levels.reduce((sum, l) => sum + l.walls.reduce((a, w) => a + wallLength(w), 0), 0);
    const doors = s.project.levels.reduce((sum, l) => sum + l.openings.filter((o) => o.kind === 'door').length, 0);
    const windows = s.project.levels.reduce((sum, l) => sum + l.openings.filter((o) => o.kind === 'window').length, 0);
    const items = s.project.levels.reduce((sum, l) => sum + l.items.length, 0);
    const warnCount = issues.filter((i) => i.issue.severity === 'warning').length;
    return [
      section('Summary', [h('div', { class: 'stat-row wrap' },
        stat('Floor area', formatArea(total, u)), stat('Wall length', formatLength(walls, u)),
        stat('Doors', String(doors)), stat('Windows', String(windows)), stat('Furniture', String(items)))]),
      section('Room schedule', [...tables, h('div', { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', onclick: () => this.exportCsv() }, icon('table', 16), 'Export CSV'))]),
      section(`Checks${issues.length ? ` (${issues.length})` : ''}`, issues.length ? [h('ul', { class: 'issues' }, ...issues.map(({ level, issue }) =>
        h('li', {}, h('button', {
          class: `issue issue-${issue.severity}`, type: 'button',
          onclick: () => { s.setLevel(level.id); s.select(issue.target); this.setTab('inspect'); },
        }, icon(issue.severity === 'warning' ? 'warning' : 'info', 14), h('span', {}, issue.message), h('span', { class: 'issue-level' }, level.name)))))]
        : [h('p', { class: 'ok small' }, icon('check', 14), warnCount ? '' : ' No problems found: furniture fits, doors are clear and rooms are enclosed.')]),
    ];
  }

  // ---------------------------------------------------------------- view
  private viewTab(): Node[] {
    const s = this.store;
    const v = s.view;
    const layouts = s.project.layouts;
    return [
      section('Lighting', [
        segmented([{ id: 'day', label: 'Day' }, { id: 'night', label: 'Evening' }], v.night ? 'night' : 'day', (id) => s.setView({ night: id === 'night' })),
        this.slider('Sun direction', 0, 360, 5, () => v.sun, (x) => s.setView({ sun: x }), (x) => `${Math.round(x)}°`),
      ]),
      section('3D view', [
        this.slider('Doors open', 0, 1, 0.05, () => v.doorsOpen, (x) => s.setView({ doorsOpen: x }), (x) => `${Math.round(x * 100)}%`),
        this.toggle('Cutaway walls (orbit view)', () => v.cutaway, (x) => s.setView({ cutaway: x })),
        this.slider('Eye height (walk)', 0.9, 2.0, 0.01, () => v.eye, (x) => s.setView({ eye: x }), (x) => formatLength(x, v.units)),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Quality'),
          segmented([{ id: 'high', label: 'High' }, { id: 'low', label: 'Fast' }], v.quality, (id) => s.setView({ quality: id as 'high' | 'low' }))),
      ]),
      section('Plan', [
        this.toggle('Grid', () => v.showGrid, (x) => s.setView({ showGrid: x })),
        this.toggle('Snapping', () => v.snap, (x) => s.setView({ snap: x })),
        this.toggle('Show level below', () => v.ghostLevel, (x) => s.setView({ ghostLevel: x })),
        this.toggle('Reference drawing', () => v.showUnderlay, (x) => s.setView({ showUnderlay: x })),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Units'),
          segmented([{ id: 'm', label: 'Metres' }, { id: 'cm', label: 'Centimetres' }, { id: 'ft', label: 'Feet' }], v.units, (id) => s.setView({ units: id as Units }))),
      ]),
      section('Furniture layouts', [
        h('p', { class: 'muted small' }, 'Save alternative furniture arrangements and switch between them to compare. Walls are shared by all layouts.'),
        layouts.length ? h('ul', { class: 'layout-list' }, ...layouts.map((l) => h('li', { class: l.id === s.project.activeLayoutId ? 'active' : '' },
          h('button', { class: 'link', type: 'button', onclick: () => s.switchLayout(l.id) }, l.name, l.id === s.project.activeLayoutId ? ' (current)' : ''),
          iconButton('trash', `Delete layout ${l.name}`, async () => {
            if (await confirmDialog('Delete layout', `Delete “${l.name}”? Furniture currently in the plan is kept.`, 'Delete', true)) s.deleteLayout(l.id);
          })))) : null,
        h('div', { class: 'btn-row' }, h('button', {
          class: 'btn', type: 'button',
          onclick: async () => { const n = await promptDialog('Save layout', 'Layout name', `Layout ${String.fromCharCode(65 + layouts.length)}`); if (n) { s.saveLayout(n); toast(`Saved “${n}”.`, 'success'); } },
        }, icon('plus', 16), 'Save current as layout')),
      ].filter(Boolean) as Node[]),
    ];
  }

  // ---------------------------------------------------------- operations
  private cur<T>(): T | undefined { return this.store.find() as T | undefined; }

  private addItem(spec: Omit<Item, 'id' | 'x' | 'z' | 'rot'>) {
    const c = this.host.viewCenter();
    const it: Item = { id: uid('i'), x: round(c.x), z: round(c.z), rot: 0, ...spec };
    this.store.mutate((_p, l) => { l.items.push(it); });
    this.store.setTool('select');
    this.store.select({ kind: 'item', id: it.id });
    toast(`Added ${spec.name}. Drag it into place.`);
  }

  private addModel(modelId: string, name: string) {
    const m = this.models.find((x) => x.id === modelId);
    const dim = (v: number | undefined) => Math.min(20, Math.max(0.05, Math.round((v ?? 1) * 1000) / 1000));
    this.addItem({ type: 'model', name, w: dim(m?.size?.x), d: dim(m?.size?.z), h: dim(m?.size?.y), color: '#c4bdb3', modelId });
  }

  private async importModel() {
    const file = await pickFile('.glb,.gltf,model/gltf-binary,model/gltf+json');
    if (!file) return;
    try {
      const info = await this.library.importFile(file);
      this.models = await this.library.list();
      this.addModel(info.id, info.name);
      this.schedule(true);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not import the model.', 'error');
    }
  }

  private addStair() {
    const c = this.host.viewCenter();
    const st: Stair = { id: uid('s'), x: round(c.x), z: round(c.z), rot: 0, width: 1, length: 3 };
    this.store.mutate((_p, l) => { l.stairs.push(st); });
    this.store.select({ kind: 'stair', id: st.id });
    this.setTab('inspect');
  }

  private addOpeningAt(w: Wall, kind: 'door' | 'window') {
    const len = wallLength(w);
    const width = Math.min(kind === 'door' ? 0.9 : 1.2, len - 0.1);
    if (width < 0.3) { toast('That wall is too short.', 'error'); return; }
    const o: Opening = kind === 'door'
      ? { id: uid('o'), wallId: w.id, kind, offset: len / 2, width, height: 2.1, sill: 0, hinge: 'start', swing: 'left' }
      : { id: uid('o'), wallId: w.id, kind, offset: len / 2, width, height: 1.3, sill: 0.9 };
    this.store.mutate((_p, l) => { l.openings.push(o); });
    this.store.select({ kind: 'opening', id: o.id });
  }

  private addLevel() {
    const s = this.store;
    const top = s.sortedLevels()[s.sortedLevels().length - 1];
    const id = uid('L');
    s.mutate((p) => {
      p.levels.push({ id, name: `Level ${p.levels.length + 1}`, elevation: round(top.elevation + top.height + 0.3), height: top.height, walls: [], openings: [], rooms: [], items: [], stairs: [] });
    });
    s.setLevel(id);
    toast('New level added. Tip: “Duplicate” copies the walls of a level.');
  }

  private duplicateLevel() {
    const s = this.store;
    const src = s.level;
    const top = s.sortedLevels()[s.sortedLevels().length - 1];
    const id = uid('L');
    s.mutate((p) => {
      const idMap = new Map<string, string>();
      const walls = src.walls.map((w) => { const nid = uid('w'); idMap.set(w.id, nid); return { ...structuredClone(w), id: nid }; });
      p.levels.push({
        id, name: `${src.name} copy`, elevation: round(top.elevation + top.height + 0.3), height: src.height,
        walls,
        openings: src.openings.map((o) => ({ ...o, id: uid('o'), wallId: idMap.get(o.wallId)! })),
        rooms: src.rooms.map((r) => ({ ...structuredClone(r), id: uid('r') })),
        items: [], stairs: [],
      });
    });
    s.setLevel(id);
  }

  private async deleteLevel() {
    const s = this.store;
    if (s.project.levels.length < 2) return;
    const level = s.level;
    if (!(await confirmDialog('Delete level', `Delete “${level.name}” and everything on it? You can undo this.`, 'Delete level', true))) return;
    s.mutate((p) => {
      p.levels = p.levels.filter((l) => l.id !== level.id);
      delete p.underlays[level.id];
    });
    s.setLevel(s.sortedLevels()[0].id);
  }

  private exportCsv() {
    const s = this.store;
    const rows = [['Level', 'Room', 'Floor', 'Area (m2)', 'Enclosed']];
    for (const level of s.sortedLevels()) {
      const regions = roomRegions(level);
      for (const r of level.rooms) {
        const reg = regions.get(r.id);
        rows.push([level.name, r.name, r.floor, reg?.enclosed ? reg.area.toFixed(2) : '', reg?.enclosed ? 'yes' : 'no']);
      }
    }
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    download(new Blob([csv], { type: 'text/csv' }), `${slug(s.project.name)}-rooms.csv`);
  }

  private swatch(f: FloorMaterial): string {
    let src = this.swatches.get(f);
    if (!src) { src = floorSwatch(f); this.swatches.set(f, src); }
    return src;
  }

  // -------------------------------------------------------------- fields
  /** Inspector header whose title follows the edited object's name. */
  private liveHeader(title: () => string, ic: Parameters<typeof icon>[0], onDelete: () => void): HTMLElement {
    const el = header(title(), ic, onDelete);
    const t = el.querySelector('.inspector-title')!;
    this.refreshers.push(() => { t.textContent = title(); });
    return el;
  }

  private lengthField(label: string, get: () => number, set: (v: number) => void, min: number, max: number, hint?: string): HTMLElement {
    const units = this.store.view.units;
    const input = h('input', { class: 'input', inputmode: 'decimal', 'aria-label': `${label} (${unitLabel(units)})`, spellcheck: 'false' });
    const show = () => { if (document.activeElement !== input) input.value = String(toUnit(get(), units)); };
    const commit = () => {
      const v = parseLength(input.value, units);
      if (v === null || !Number.isFinite(v)) { input.classList.add('invalid'); return; }
      input.classList.remove('invalid');
      set(clampN(v, min, max));
      input.value = String(toUnit(clampN(v, min, max), units));
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { commit(); input.select(); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const stepM = e.shiftKey ? 0.1 : units === 'ft' ? 0.0254 : 0.01;
        const v = clampN(get() + (e.key === 'ArrowUp' ? stepM : -stepM), min, max);
        set(round(v));
        input.value = String(toUnit(v, units));
      }
    });
    input.addEventListener('blur', () => { input.classList.remove('invalid'); show(); });
    show();
    this.refreshers.push(show);
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label),
      h('span', { class: 'input-unit' }, input, h('span', { class: 'unit' }, unitLabel(units))),
      hint ? h('span', { class: 'field-hint' }, hint) : null);
  }

  private numberField(label: string, unit: string, get: () => number, set: (v: number) => void, min: number, max: number, step: number): HTMLElement {
    const input = h('input', { class: 'input', type: 'number', step: String(step), min: String(min), max: String(max), 'aria-label': label });
    const show = () => { if (document.activeElement !== input) input.value = String(get()); };
    input.addEventListener('input', () => { const v = parseFloat(input.value); if (Number.isFinite(v)) set(clampN(v, min, max)); });
    show();
    this.refreshers.push(show);
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), h('span', { class: 'input-unit' }, input, h('span', { class: 'unit' }, unit)));
  }

  private textField(label: string, get: () => string, set: (v: string) => void): HTMLElement {
    const input = h('input', { class: 'input', 'aria-label': label, maxlength: 80 });
    const show = () => { if (document.activeElement !== input) input.value = get(); };
    input.addEventListener('input', () => set(input.value.trim()));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    show();
    this.refreshers.push(show);
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input);
  }

  private colorField(label: string, get: () => string, set: (v: string) => void): HTMLElement {
    const input = h('input', { class: 'color', type: 'color', 'aria-label': label });
    const show = () => { if (document.activeElement !== input) input.value = get(); };
    input.addEventListener('input', () => set(input.value));
    show();
    this.refreshers.push(show);
    return h('label', { class: 'field field-inline' }, h('span', { class: 'field-label' }, label), input);
  }

  private toggle(label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
    const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch' });
    const show = () => { input.checked = get(); };
    input.addEventListener('change', () => set(input.checked));
    show();
    this.refreshers.push(show);
    return h('label', { class: 'toggle' }, h('span', {}, label), input);
  }

  private slider(label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string): HTMLElement {
    const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': label, class: 'range' });
    const out = h('output', { class: 'range-value' });
    const show = () => { if (document.activeElement !== input) input.value = String(get()); out.textContent = fmt(get()); };
    input.addEventListener('input', () => { set(parseFloat(input.value)); out.textContent = fmt(parseFloat(input.value)); });
    show();
    this.refreshers.push(show);
    return h('label', { class: 'field' }, h('span', { class: 'field-label field-label-row' }, label, out), input);
  }
}

// ---------------------------------------------------------------- helpers
function section(title: string, children: Node[]): HTMLElement {
  return h('section', { class: 'section' }, h('h3', { class: 'section-title' }, title), ...children);
}

function header(title: string, ic: Parameters<typeof icon>[0], onDelete: () => void): HTMLElement {
  return h('div', { class: 'inspector-head' },
    h('span', { class: 'inspector-icon' }, icon(ic, 18)),
    h('h2', { class: 'inspector-title' }, title),
    iconButton('trash', 'Delete', onDelete, 'Del', { class: 'icon-btn danger' }));
}

function stat(label: string, value: string): HTMLElement {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, value), h('span', { class: 'stat-label' }, label));
}

function segmented(options: { id: string; label: string }[], value: string, onChange: (id: string) => void): HTMLElement {
  const group = h('div', { class: 'segmented', role: 'radiogroup' });
  for (const o of options) {
    group.append(h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(o.id === value), class: o.id === value ? 'on' : '',
      onclick: () => onChange(o.id),
    }, o.label));
  }
  return group;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const round = (v: number) => Math.round(v * 1000) / 1000;
const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const norm = (a: number) => {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r < -Math.PI) r += Math.PI * 2;
  return round(r);
};
