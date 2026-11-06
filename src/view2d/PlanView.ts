import type { ChangeKind, Store } from '../model/store';
import type { Item, Level, Opening, Selection, Stair, Vec2, Wall } from '../model/types';
import { formatArea, formatLength } from '../model/units';
import { uid } from '../model/ids';
import { itemObb } from '../geometry/checks';
import { dist, normAngle, obbCorners, pointInObb, pointSegment, round3 as round, toWorld } from '../geometry/math';
import { mix, withAlpha } from './colors';
import { pointInRegion, type Region, regionAt, roomRegions } from '../geometry/rooms';
import { stairFootprint, stairSections } from '../geometry/stairs';
import { endExtensions, JOIN_TOL, openingSpans, wallDir, wallLength, wallObb } from '../geometry/walls';

export interface PlanCallbacks {
  toast: (msg: string, kind?: 'info' | 'error') => void;
  teleport: (x: number, z: number) => void;
  calibrate: (a: Vec2, b: Vec2) => void;
}

export interface ToolPrefs { wallThickness: number; doorWidth: number; windowWidth: number }

type Drag =
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { kind: 'item'; id: string; dx: number; dz: number; key: string }
  | { kind: 'rotate'; id: string; key: string }
  | { kind: 'stair'; id: string; dx: number; dz: number; key: string }
  | { kind: 'room'; id: string; key: string }
  | { kind: 'opening'; id: string; key: string }
  | { kind: 'endpoint'; id: string; end: 'a' | 'b'; linked: { id: string; end: 'a' | 'b' }[]; key: string }
  | { kind: 'wall'; id: string; start: Vec2; a0: Vec2; b0: Vec2; linked: { id: string; end: 'a' | 'b'; p0: Vec2 }[]; key: string }
  | { kind: 'measure' };

interface Theme { bg: string; grid: string; gridMajor: string; wall: string; text: string; muted: string; accent: string; door: string; window: string; room: string; item: string }

// Paths are cached per (immutable) underlay array / room region, so redraws during
// drags do not re-trace thousands of segments.
const segmentPaths = new WeakMap<number[], Path2D>();
function segmentsPath(s: number[]): Path2D {
  let p = segmentPaths.get(s);
  if (!p) {
    p = new Path2D();
    for (let i = 0; i < s.length; i += 4) { p.moveTo(s[i], s[i + 1]); p.lineTo(s[i + 2], s[i + 3]); }
    segmentPaths.set(s, p);
  }
  return p;
}
const regionPaths = new WeakMap<Region, Path2D>();
function regionPath(reg: Region): Path2D {
  let p = regionPaths.get(reg);
  if (!p) {
    p = new Path2D();
    for (const q of reg.rects) p.rect(q.x, q.z, q.w, q.d);
    regionPaths.set(reg, p);
  }
  return p;
}

const widths = new Map<string, number>();
/** Memoised text width (labels are re-measured on every redraw otherwise). */
function textWidth(ctx: CanvasRenderingContext2D, text: string): number {
  const key = `${ctx.font}|${text}`;
  let w = widths.get(key);
  if (w === undefined) {
    if (widths.size > 4000) widths.clear();
    w = ctx.measureText(text).width;
    widths.set(key, w);
  }
  return w;
}

const FLOOR_TINT: Record<string, string> = {
  oak: '#e9d8bf', walnut: '#d5bfa6', tile: '#e2e4e4', marble: '#ecebe7', carpet: '#e0dbd3', concrete: '#d9d8d4',
};

/** Interactive 2D floor plan editor for the active level. */
export class PlanView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scale = 50;          // pixels per metre
  private ox = 0;              // screen position of world origin
  private oy = 0;
  private dpr = 1;
  private needsDraw = true;
  private drag: Drag | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; scale: number; cx: number; cy: number; ox: number; oy: number } | null = null;
  private cursor: Vec2 = { x: 0, z: 0 };
  private cursorScreen = { x: -1, y: -1 };
  private snapped: Vec2 | null = null;
  private hover: Selection | null = null;
  private draft: Vec2[] = [];
  private measureLine: { a: Vec2; b: Vec2 } | null = null;
  private calib: Vec2 | null = null;
  private spaceDown = false;
  private theme!: Theme;
  private images = new Map<string, HTMLImageElement>();
  private resizeObs: ResizeObserver;
  private fitted = false;
  pose: { x: number; z: number; dirX: number; dirZ: number; levelId: string; walking: boolean } | null = null;
  prefs: ToolPrefs = { wallThickness: 0.15, doorWidth: 0.9, windowWidth: 1.2 };

  constructor(private host: HTMLElement, private store: Store, private cb: PlanCallbacks) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'plan-canvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'application');
    this.canvas.setAttribute('aria-label', 'Floor plan editor. Use the toolbar or keyboard shortcuts to draw and edit.');
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.readTheme();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { this.readTheme(); this.invalidate(); });
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.bind();
    store.subscribe((k) => this.onChange(k));
    const loop = () => {
      if (this.needsDraw) { this.needsDraw = false; this.draw(); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  invalidate() { this.needsDraw = true; }

  readTheme() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
    this.theme = {
      bg: v('--plan-bg', '#fbfaf8'), grid: v('--plan-grid', '#eceae6'), gridMajor: v('--plan-grid-major', '#dcd9d3'),
      wall: v('--plan-wall', '#37352f'), text: v('--text', '#1f1d1a'), muted: v('--muted', '#7a766f'),
      accent: v('--accent', '#e8467c'), door: v('--plan-door', '#b4532a'), window: v('--plan-window', '#2f7fc1'),
      room: v('--plan-room-label', '#4a463f'), item: v('--plan-item', '#ffffff'),
    };
  }

  /** Zoom and pan so the whole active level is visible. */
  fit() {
    const pts: Vec2[] = [];
    const lvl = this.store.level;
    lvl.walls.forEach((w) => pts.push(w.a, w.b));
    lvl.items.forEach((i) => pts.push({ x: i.x, z: i.z }));
    const ul = this.store.project.underlays[lvl.id];
    if (!pts.length && ul?.kind === 'cad') for (let i = 0; i < ul.segments.length; i += 2) pts.push({ x: ul.segments[i], z: ul.segments[i + 1] });
    if (!pts.length && ul?.kind === 'image') pts.push({ x: ul.x, z: ul.z }, { x: ul.x + ul.width * ul.scale, z: ul.z + ul.height * ul.scale });
    const w = this.canvas.clientWidth || 600, h = this.canvas.clientHeight || 400;
    if (!pts.length) { this.scale = 50; this.ox = w / 2; this.oy = h / 2; this.invalidate(); return; }
    const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
    const minZ = Math.min(...pts.map((p) => p.z)), maxZ = Math.max(...pts.map((p) => p.z));
    const pad = 48;
    this.scale = Math.max(5, Math.min(400, Math.min((w - pad * 2) / Math.max(1, maxX - minX), (h - pad * 2) / Math.max(1, maxZ - minZ))));
    this.ox = w / 2 - ((minX + maxX) / 2) * this.scale;
    this.oy = h / 2 - ((minZ + maxZ) / 2) * this.scale;
    this.invalidate();
  }

  zoomBy(f: number) {
    const cx = this.canvas.clientWidth / 2, cy = this.canvas.clientHeight / 2;
    this.zoomAt(cx, cy, f);
  }

  /** Cancel the current drawing operation. Returns true if something was cancelled. */
  cancel(): boolean {
    if (this.draft.length || this.measureLine || this.calib) {
      this.draft = []; this.measureLine = null; this.calib = null;
      this.invalidate();
      return true;
    }
    return false;
  }

  /** Finish a wall chain being drawn. */
  finishDraft() {
    this.draft = [];
    this.invalidate();
  }

  /** Centre of the visible plan area in world coordinates. */
  viewCenter(): Vec2 {
    return this.toWorld(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2);
  }

  setSpace(down: boolean) { this.spaceDown = down; this.updateCursor(); }

  // --------------------------------------------------------------- events
  private onChange(k: Set<ChangeKind>) {
    if (k.has('level')) { this.draft = []; this.measureLine = null; }
    if (k.has('tool')) { this.draft = []; this.calib = null; this.updateCursor(); }
    if ((k.has('project') || k.has('level')) && !this.fitted && this.canvas.clientWidth) { this.fitted = true; this.fit(); }
    this.invalidate();
  }

  private resize() {
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    const w = this.host.clientWidth, h = this.host.clientHeight;
    const prevW = this.canvas.clientWidth, prevH = this.canvas.clientHeight;
    this.canvas.width = Math.max(1, Math.round(w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(h * this.dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    if (!this.fitted && w > 0) { this.fitted = true; this.fit(); } else if (prevW) {
      this.ox += (w - prevW) / 2; this.oy += (h - prevH) / 2;
    }
    this.invalidate();
  }

  private toWorld(sx: number, sy: number): Vec2 { return { x: (sx - this.ox) / this.scale, z: (sy - this.oy) / this.scale }; }
  private toScreen(p: Vec2): [number, number] { return [p.x * this.scale + this.ox, p.z * this.scale + this.oy]; }

  private zoomAt(sx: number, sy: number, f: number) {
    const before = this.toWorld(sx, sy);
    this.scale = Math.max(4, Math.min(600, this.scale * f));
    this.ox = sx - before.x * this.scale;
    this.oy = sy - before.z * this.scale;
    this.invalidate();
  }

  private bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => this.onUp(e));
    c.addEventListener('pointerleave', () => { this.cursorScreen = { x: -1, y: -1 }; this.hover = null; this.invalidate(); });
    c.addEventListener('dblclick', (e) => this.onDouble(e));
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.draft.length) this.finishDraft();
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
        this.zoomAt(e.clientX - r.left, e.clientY - r.top, f);
      } else {
        this.ox -= e.deltaX; this.oy -= e.deltaY; this.invalidate();
      }
    }, { passive: false });
  }

  private local(e: PointerEvent | MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown(e: PointerEvent) {
    this.canvas.focus({ preventScroll: true });
    const { x, y } = this.local(e);
    this.pointers.set(e.pointerId, { x, y });
    this.canvas.setPointerCapture(e.pointerId);
    if (this.pointers.size === 2) {
      const [p, q] = [...this.pointers.values()];
      this.drag = null;
      this.draft = this.draft.slice(0, Math.max(0, this.draft.length));
      this.pinch = { d: Math.hypot(p.x - q.x, p.y - q.y), scale: this.scale, cx: (p.x + q.x) / 2, cy: (p.y + q.y) / 2, ox: this.ox, oy: this.oy };
      return;
    }
    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      this.drag = { kind: 'pan', sx: x, sy: y, ox: this.ox, oy: this.oy };
      return;
    }
    if (e.button !== 0) return;
    const w = this.toWorld(x, y);
    const tool = this.store.tool;
    const level = this.store.level;
    const key = `drag:${uid()}`;

    if (tool === 'select') {
      const sel = this.store.selection;
      // Handles of the current selection take priority.
      if (sel?.kind === 'item') {
        const it = level.items.find((i) => i.id === sel.id);
        if (it && this.nearRotateHandle(it, x, y)) { this.drag = { kind: 'rotate', id: it.id, key }; return; }
      }
      if (sel?.kind === 'wall') {
        const wall = level.walls.find((q) => q.id === sel.id);
        if (wall) {
          for (const end of ['a', 'b'] as const) {
            const [sx, sy] = this.toScreen(wall[end]);
            if (Math.hypot(sx - x, sy - y) < 9) {
              this.drag = { kind: 'endpoint', id: wall.id, end, linked: this.linkedEnds(level, wall[end], wall.id), key };
              return;
            }
          }
        }
      }
      const hit = this.hitTest(w, level);
      this.store.select(hit);
      if (!hit) { this.drag = { kind: 'pan', sx: x, sy: y, ox: this.ox, oy: this.oy }; return; }
      if (hit.kind === 'item') {
        const it = level.items.find((i) => i.id === hit.id)!;
        this.drag = { kind: 'item', id: it.id, dx: it.x - w.x, dz: it.z - w.z, key };
      } else if (hit.kind === 'stair') {
        const s = level.stairs.find((i) => i.id === hit.id)!;
        this.drag = { kind: 'stair', id: s.id, dx: s.x - w.x, dz: s.z - w.z, key };
      } else if (hit.kind === 'room') {
        const r = level.rooms.find((i) => i.id === hit.id)!;
        const [sx, sy] = this.toScreen(roomLabelPos(level, r.id));
        if (Math.hypot(sx - x, sy - y) < 40) this.drag = { kind: 'room', id: r.id, key };
        else this.drag = { kind: 'pan', sx: x, sy: y, ox: this.ox, oy: this.oy };
      } else if (hit.kind === 'opening') {
        this.drag = { kind: 'opening', id: hit.id, key };
      } else if (hit.kind === 'wall') {
        const wall = level.walls.find((q) => q.id === hit.id)!;
        const linked = [...this.linkedEnds(level, wall.a, wall.id).map((l) => ({ ...l, p0: { ...this.endOf(level, l) } })),
          ...this.linkedEnds(level, wall.b, wall.id).map((l) => ({ ...l, p0: { ...this.endOf(level, l) } }))];
        this.drag = { kind: 'wall', id: wall.id, start: w, a0: { ...wall.a }, b0: { ...wall.b }, linked, key };
      }
      return;
    }

    const p = this.snap(w, tool === 'wall' ? this.draft[this.draft.length - 1] : undefined);
    if (tool === 'wall') {
      if (this.draft.length && dist(p, this.draft[0]) < 1e-6 && this.draft.length > 2) {
        this.addWall(this.draft[this.draft.length - 1], p);
        this.draft = [];
      } else if (this.draft.length) {
        const last = this.draft[this.draft.length - 1];
        if (dist(last, p) > 0.05) { this.addWall(last, p); this.draft.push(p); }
      } else this.draft = [p];
    } else if (tool === 'door' || tool === 'window') {
      this.placeOpening(w, tool);
    } else if (tool === 'room') {
      this.placeRoom(w);
    } else if (tool === 'stair') {
      const s: Stair = { id: uid('s'), x: round(p.x), z: round(p.z), rot: 0, width: 1.0, length: 3.0 };
      this.store.mutate((_pr, l) => { l.stairs.push(s); });
      this.store.setTool('select');
      this.store.select({ kind: 'stair', id: s.id });
      if (!this.store.levelAbove()) this.cb.toast('Stairs lead to the level above — add a level to walk up them.');
    } else if (tool === 'measure') {
      this.measureLine = { a: p, b: p };
      this.drag = { kind: 'measure' };
    } else if (tool === 'calibrate') {
      if (!this.calib) this.calib = p;
      else { const a = this.calib; this.calib = null; this.store.setTool('select'); this.cb.calibrate(a, p); }
    }
    this.invalidate();
  }

  private onMove(e: PointerEvent) {
    const { x, y } = this.local(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x, y });
    if (this.pinch && this.pointers.size === 2) {
      const [p, q] = [...this.pointers.values()];
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      const cx = (p.x + q.x) / 2, cy = (p.y + q.y) / 2;
      const f = d / this.pinch.d;
      const world = { x: (this.pinch.cx - this.pinch.ox) / this.pinch.scale, z: (this.pinch.cy - this.pinch.oy) / this.pinch.scale };
      this.scale = Math.max(4, Math.min(600, this.pinch.scale * f));
      this.ox = cx - world.x * this.scale;
      this.oy = cy - world.z * this.scale;
      this.invalidate();
      return;
    }
    this.cursorScreen = { x, y };
    const w = this.toWorld(x, y);
    this.cursor = w;
    const tool = this.store.tool;
    const level = this.store.level;
    const d = this.drag;
    if (d) {
      const snap = this.store.view.snap;
      switch (d.kind) {
        case 'pan':
          this.ox = d.ox + (x - d.sx); this.oy = d.oy + (y - d.sy);
          break;
        case 'item':
          this.store.mutate((_p, l) => {
            const it = l.items.find((i) => i.id === d.id);
            if (!it) return;
            const nx = w.x + d.dx, nz = w.z + d.dz;
            const snappedPos = snap ? this.snapItem(l, it, nx, nz) : { x: nx, z: nz };
            it.x = round(snappedPos.x); it.z = round(snappedPos.z);
          }, d.key);
          break;
        case 'rotate':
          this.store.mutate((_p, l) => {
            const it = l.items.find((i) => i.id === d.id);
            if (!it) return;
            // Handle sits behind the item (local -Z); rot maps local -Z to world (-sin, -cos).
            let r = Math.atan2(-(w.x - it.x), -(w.z - it.z));
            if (snap && !e.altKey) r = Math.round(r / (Math.PI / 12)) * (Math.PI / 12);
            it.rot = normAngle(r);
          }, d.key);
          break;
        case 'stair':
          this.store.mutate((_p, l) => {
            const s = l.stairs.find((i) => i.id === d.id);
            if (!s) return;
            const g = snap ? 0.05 : 0.001;
            s.x = Math.round((w.x + d.dx) / g) * g; s.z = Math.round((w.z + d.dz) / g) * g;
          }, d.key);
          break;
        case 'room':
          this.store.mutate((_p, l) => {
            const r = l.rooms.find((i) => i.id === d.id);
            if (r) r.seed = { x: round(w.x), z: round(w.z) };
          }, d.key);
          break;
        case 'opening':
          this.store.mutate((_p, l) => {
            const o = l.openings.find((i) => i.id === d.id);
            const wall = o && l.walls.find((q) => q.id === o.wallId);
            if (!o || !wall) return;
            const len = wallLength(wall);
            const t = pointSegment(w, wall.a, wall.b).t * len;
            const half = o.width / 2;
            let off = Math.min(len - half, Math.max(half, t));
            if (snap) off = Math.round(off / 0.05) * 0.05;
            o.offset = round(off);
          }, d.key);
          break;
        case 'endpoint': {
          const p = this.snap(w, undefined, d.id);
          this.store.mutate((_p, l) => {
            const wall = l.walls.find((q) => q.id === d.id);
            if (!wall) return;
            wall[d.end] = { ...p };
            for (const lk of d.linked) {
              const o = l.walls.find((q) => q.id === lk.id);
              if (o) o[lk.end] = { ...p };
            }
          }, d.key);
          break;
        }
        case 'wall': {
          let dx = w.x - d.start.x, dz = w.z - d.start.z;
          if (snap) { dx = Math.round(dx / 0.05) * 0.05; dz = Math.round(dz / 0.05) * 0.05; }
          this.store.mutate((_p, l) => {
            const wall = l.walls.find((q) => q.id === d.id);
            if (!wall) return;
            wall.a = { x: round(d.a0.x + dx), z: round(d.a0.z + dz) };
            wall.b = { x: round(d.b0.x + dx), z: round(d.b0.z + dz) };
            for (const lk of d.linked) {
              const o = l.walls.find((q) => q.id === lk.id);
              if (o) o[lk.end] = { x: round(lk.p0.x + dx), z: round(lk.p0.z + dz) };
            }
          }, d.key);
          break;
        }
        case 'measure':
          if (this.measureLine) this.measureLine.b = this.snap(w, this.measureLine.a);
          break;
      }
      this.invalidate();
      return;
    }
    if (tool === 'select') {
      const h = this.hitTest(w, level);
      if (h?.id !== this.hover?.id) { this.hover = h; this.updateCursor(); }
    } else {
      this.snapped = this.snap(w, tool === 'wall' ? this.draft[this.draft.length - 1] : this.measureLine?.a);
    }
    this.invalidate();
  }

  private onUp(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.drag && this.drag.kind !== 'pan' && this.drag.kind !== 'measure') this.store.endMerge();
    this.drag = null;
    this.invalidate();
  }

  private onDouble(e: MouseEvent) {
    const { x, y } = this.local(e);
    const w = this.toWorld(x, y);
    if (this.store.tool === 'wall') { this.finishDraft(); return; }
    if (this.store.tool !== 'select') return;
    const hit = this.hitTest(w, this.store.level);
    if (!hit || hit.kind === 'room') this.cb.teleport(w.x, w.z);
  }

  private updateCursor() {
    const t = this.store.tool;
    let c = 'default';
    if (this.spaceDown || this.drag?.kind === 'pan') c = 'grab';
    else if (t !== 'select') c = 'crosshair';
    else if (this.hover) c = this.hover.kind === 'room' ? 'pointer' : 'move';
    this.canvas.style.cursor = c;
  }

  // ------------------------------------------------------------ hit tests
  private hitTest(w: Vec2, level: Level): Selection | null {
    const tol = 5 / this.scale;
    for (let i = level.items.length - 1; i >= 0; i--) {
      const it = level.items[i];
      if (pointInObb(itemObb(it), w.x, w.z, tol)) return { kind: 'item', id: it.id };
    }
    for (const s of level.stairs) if (stairFootprint(s).some((f) => pointInObb(f, w.x, w.z, tol))) return { kind: 'stair', id: s.id };
    for (const o of level.openings) {
      const seg = this.openingSegment(level, o);
      if (seg && pointSegment(w, seg.a, seg.b).d < seg.t / 2 + tol) return { kind: 'opening', id: o.id };
    }
    for (const wall of level.walls) {
      if (pointSegment(w, wall.a, wall.b).d < wall.thickness / 2 + tol) return { kind: 'wall', id: wall.id };
    }
    const regions = roomRegions(level);
    for (const r of level.rooms) {
      const [lx, ly] = this.toScreen(roomLabelPos(level, r.id));
      const [sx, sy] = this.toScreen(w);
      if (Math.abs(sx - lx) < 50 && Math.abs(sy - ly) < 18) return { kind: 'room', id: r.id };
    }
    for (const r of level.rooms) {
      const reg = regions.get(r.id);
      if (reg?.enclosed && pointInRegion(reg, w.x, w.z)) return { kind: 'room', id: r.id };
    }
    return null;
  }

  private openingSegment(level: Level, o: Opening) {
    const wall = level.walls.find((q) => q.id === o.wallId);
    if (!wall) return null;
    const span = openingSpans(wall, level.openings).find((s) => s.opening.id === o.id);
    if (!span) return null;
    const { ux, uz } = wallDir(wall);
    return {
      a: { x: wall.a.x + ux * span.from, z: wall.a.z + uz * span.from },
      b: { x: wall.a.x + ux * span.to, z: wall.a.z + uz * span.to },
      t: wall.thickness, wall, span,
    };
  }

  private rotateHandle(it: Item): Vec2 {
    const [x, z] = toWorld(itemObb(it), 0, -(it.d / 2 + 22 / this.scale));
    return { x, z };
  }

  private nearRotateHandle(it: Item, sx: number, sy: number) {
    const [hx, hy] = this.toScreen(this.rotateHandle(it));
    return Math.hypot(hx - sx, hy - sy) < 10;
  }

  private linkedEnds(level: Level, p: Vec2, exclude: string) {
    const out: { id: string; end: 'a' | 'b' }[] = [];
    for (const w of level.walls) {
      if (w.id === exclude) continue;
      if (dist(w.a, p) < JOIN_TOL) out.push({ id: w.id, end: 'a' });
      if (dist(w.b, p) < JOIN_TOL) out.push({ id: w.id, end: 'b' });
    }
    return out;
  }

  private endOf(level: Level, l: { id: string; end: 'a' | 'b' }): Vec2 {
    return level.walls.find((w) => w.id === l.id)![l.end];
  }

  // -------------------------------------------------------------- snapping
  /** Snap to wall endpoints, then wall centrelines, then angle/grid. */
  private snap(p: Vec2, from?: Vec2, excludeWall?: string): Vec2 {
    if (!this.store.view.snap) return { x: round(p.x), z: round(p.z) };
    const level = this.store.level;
    const tol = 10 / this.scale;
    let best: Vec2 | null = null, bestD = tol;
    for (const w of level.walls) {
      if (w.id === excludeWall) continue;
      for (const q of [w.a, w.b]) {
        const d = dist(p, q);
        if (d < bestD) { bestD = d; best = q; }
      }
    }
    if (best) return { ...best };
    if (from) {
      const dx = p.x - from.x, dz = p.z - from.z;
      const len = Math.hypot(dx, dz);
      if (len > 1e-6) {
        const step = Math.PI / 12;
        const ang = Math.atan2(dz, dx);
        const sn = Math.round(ang / step) * step;
        if (Math.abs(ang - sn) < 0.07) {
          const l = Math.round(len / 0.05) * 0.05;
          return { x: round(from.x + Math.cos(sn) * l), z: round(from.z + Math.sin(sn) * l) };
        }
      }
    }
    for (const w of level.walls) {
      if (w.id === excludeWall) continue;
      const r = pointSegment(p, w.a, w.b);
      if (r.d < 6 / this.scale) {
        const len = wallLength(w);
        const t = Math.round((r.t * len) / 0.05) * 0.05;
        const { ux, uz } = wallDir(w);
        return { x: round(w.a.x + ux * t), z: round(w.a.z + uz * t) };
      }
    }
    const g = this.scale > 120 ? 0.05 : this.scale > 40 ? 0.1 : 0.25;
    return { x: round(Math.round(p.x / g) * g), z: round(Math.round(p.z / g) * g) };
  }

  /** Snap an item flush against nearby walls (back or sides), otherwise to a 5 cm grid. */
  private snapItem(level: Level, it: Item, x: number, z: number): Vec2 {
    let px = Math.round(x / 0.05) * 0.05, pz = Math.round(z / 0.05) * 0.05;
    const tol = 12 / this.scale;
    for (const w of level.walls) {
      const { nx, nz } = wallDir(w);
      // Distance from wall centreline to item centre along the normal.
      const side = (x - w.a.x) * nx + (z - w.a.z) * nz;
      const r = pointSegment({ x, z }, w.a, w.b);
      if (r.t <= 0 || r.t >= 1) continue;
      // Half-extent of the rotated item along the wall normal.
      const c = Math.cos(it.rot), s = Math.sin(it.rot);
      const ext = Math.abs((it.w / 2) * (c * nx - s * nz)) + Math.abs((it.d / 2) * (s * nx + c * nz));
      const target = Math.sign(side || 1) * (w.thickness / 2 + ext);
      if (Math.abs(side - target) < tol) {
        const delta = target - side;
        px = x + nx * delta; pz = z + nz * delta;
        // Keep grid snapping along the wall direction.
        const { ux, uz } = wallDir(w);
        const along = (px - w.a.x) * ux + (pz - w.a.z) * uz;
        const snappedAlong = Math.round(along / 0.05) * 0.05;
        px += ux * (snappedAlong - along); pz += uz * (snappedAlong - along);
        break;
      }
    }
    return { x: px, z: pz };
  }

  // -------------------------------------------------------------- editing
  private addWall(a: Vec2, b: Vec2) {
    const w: Wall = { id: uid('w'), a: { ...a }, b: { ...b }, thickness: this.prefs.wallThickness };
    this.store.mutate((_p, l) => { l.walls.push(w); });
  }

  private placeOpening(w: Vec2, kind: 'door' | 'window') {
    const level = this.store.level;
    const hit = this.nearestWall(level, w);
    if (!hit) { this.cb.toast('Click on a wall to place a ' + kind + '.'); return; }
    const { wall, offset } = hit;
    const width = Math.min(kind === 'door' ? this.prefs.doorWidth : this.prefs.windowWidth, wallLength(wall) - 0.05);
    if (width < 0.3) { this.cb.toast('That wall is too short.', 'error'); return; }
    const half = width / 2;
    const off = Math.min(wallLength(wall) - half, Math.max(half, offset));
    const clash = level.openings.some((o) => o.wallId === wall.id && Math.abs(o.offset - off) < (o.width + width) / 2 - 0.01);
    if (clash) { this.cb.toast('There is already an opening there.', 'error'); return; }
    const o: Opening = kind === 'door'
      ? { id: uid('o'), wallId: wall.id, kind, offset: round(off), width, height: 2.1, sill: 0, hinge: 'start', swing: 'left' }
      : { id: uid('o'), wallId: wall.id, kind, offset: round(off), width, height: 1.3, sill: 0.9 };
    this.store.mutate((_p, l) => { l.openings.push(o); });
    this.store.select({ kind: 'opening', id: o.id });
  }

  private nearestWall(level: Level, w: Vec2): { wall: Wall; offset: number } | null {
    let best: { wall: Wall; offset: number } | null = null, bestD = Infinity;
    for (const wall of level.walls) {
      const r = pointSegment(w, wall.a, wall.b);
      if (r.d < wall.thickness / 2 + 12 / this.scale && r.d < bestD) {
        bestD = r.d;
        let off = r.t * wallLength(wall);
        if (this.store.view.snap) off = Math.round(off / 0.05) * 0.05;
        best = { wall, offset: off };
      }
    }
    return best;
  }

  private placeRoom(w: Vec2) {
    const level = this.store.level;
    const reg = regionAt(level, w);
    if (!reg.enclosed) { this.cb.toast('This area is not closed by walls. Close the gaps (doors count as walls) and try again.', 'error'); return; }
    const regions = roomRegions(level);
    const existing = level.rooms.find((r) => {
      const other = regions.get(r.id);
      return other?.enclosed && Math.abs(other.area - reg.area) < 1e-6 && dist(other.centroid, reg.centroid) < 0.01;
    });
    if (existing) { this.store.select({ kind: 'room', id: existing.id }); this.cb.toast(`That space is already “${existing.name}”.`); return; }
    const id = uid('r');
    this.store.mutate((_p, l) => { l.rooms.push({ id, name: `Room ${l.rooms.length + 1}`, seed: { x: round(w.x), z: round(w.z) }, floor: 'oak' }); });
    this.store.setTool('select');
    this.store.select({ kind: 'room', id });
  }

  // --------------------------------------------------------------- drawing
  private draw() {
    const { ctx, dpr } = this;
    const W = this.canvas.width / dpr, H = this.canvas.height / dpr;
    const th = this.theme;
    const level = this.store.level;
    const view = this.store.view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, W, H);
    if (view.showGrid) this.drawGrid(W, H);

    ctx.save();
    ctx.translate(this.ox, this.oy);
    ctx.scale(this.scale, this.scale);
    const px = 1 / this.scale;

    // Reference drawing.
    const ul = this.store.project.underlays[level.id];
    if (ul && view.showUnderlay) {
      ctx.globalAlpha = view.underlayOpacity;
      if (ul.kind === 'cad') {
        ctx.strokeStyle = th.muted;
        ctx.lineWidth = px;
        ctx.stroke(segmentsPath(ul.segments));
      } else {
        const img = this.image(ul.dataUrl);
        if (img.complete && img.naturalWidth) ctx.drawImage(img, ul.x, ul.z, ul.width * ul.scale, ul.height * ul.scale);
      }
      ctx.globalAlpha = 1;
    }

    // Level below as a ghost.
    const below = this.store.levelBelow();
    if (below && view.ghostLevel) {
      ctx.strokeStyle = th.gridMajor;
      ctx.setLineDash([4 * px, 4 * px]);
      for (const w of below.walls) {
        ctx.lineWidth = Math.max(w.thickness, px);
        ctx.beginPath(); ctx.moveTo(w.a.x, w.a.z); ctx.lineTo(w.b.x, w.b.z); ctx.stroke();
      }
      ctx.setLineDash([]);
      // Stairs from below arrive here.
      for (const s of below.stairs) this.drawStair(s, true);
    }

    // Rooms.
    const regions = roomRegions(level);
    const sel = this.store.selection;
    for (const r of level.rooms) {
      const reg = regions.get(r.id);
      if (!reg?.enclosed) continue;
      const selected = sel?.kind === 'room' && sel.id === r.id;
      ctx.fillStyle = selected ? withAlpha(th.accent, 0.16) : withAlpha(FLOOR_TINT[r.floor] ?? '#e8e2d8', 0.75);
      ctx.fill(regionPath(reg));
    }

    // Walls (solid parts), then openings.
    const ext = endExtensions(level.walls);
    for (const w of level.walls) {
      const e = ext.get(w.id) ?? [0, 0];
      const spans = openingSpans(w, level.openings);
      const len = wallLength(w);
      const { ux, uz } = wallDir(w);
      const pieces: [number, number][] = [];
      let cursor = -e[0];
      for (const s of spans) { if (s.from > cursor) pieces.push([cursor, s.from]); cursor = s.to; }
      if (len + e[1] > cursor) pieces.push([cursor, len + e[1]]);
      const selected = sel?.kind === 'wall' && sel.id === w.id;
      const hovered = this.hover?.kind === 'wall' && this.hover.id === w.id;
      ctx.fillStyle = selected ? th.accent : hovered ? mix(th.wall, th.accent, 0.35) : th.wall;
      for (const [a, b] of pieces) {
        const corners = obbCorners(wallObb({ ...w, a: { x: w.a.x + ux * a, z: w.a.z + uz * a }, b: { x: w.a.x + ux * b, z: w.a.z + uz * b } }));
        ctx.beginPath();
        corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.z) : ctx.moveTo(c.x, c.z)));
        ctx.closePath();
        ctx.fill();
      }
      for (const s of spans) this.drawOpening(w, s.opening, s.from, s.to, sel?.kind === 'opening' && sel.id === s.opening.id);
    }

    for (const s of level.stairs) this.drawStair(s, false, sel?.kind === 'stair' && sel.id === s.id);
    for (const it of level.items) this.drawItem(it, sel?.kind === 'item' && sel.id === it.id, this.hover?.kind === 'item' && this.hover.id === it.id);

    // Selected wall: dimension.
    if (sel?.kind === 'wall') {
      const w = level.walls.find((q) => q.id === sel.id);
      if (w) {
        this.dimension(w.a, w.b, w.thickness / 2 + 14 * px);
        for (const p of [w.a, w.b]) this.handle(p);
      }
    }

    // Wall draft preview.
    const tool = this.store.tool;
    if (tool === 'wall' && this.draft.length && this.snapped) {
      const last = this.draft[this.draft.length - 1];
      ctx.strokeStyle = withAlpha(th.accent, 0.8);
      ctx.lineWidth = this.prefs.wallThickness;
      ctx.beginPath(); ctx.moveTo(last.x, last.z); ctx.lineTo(this.snapped.x, this.snapped.z); ctx.stroke();
      this.dimension(last, this.snapped, this.prefs.wallThickness / 2 + 14 * px);
    }
    if (tool === 'measure' && this.measureLine) {
      const { a, b } = this.measureLine;
      ctx.strokeStyle = th.accent;
      ctx.lineWidth = 2 * px;
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.beginPath(); ctx.moveTo(a.x, a.z); ctx.lineTo(b.x, b.z); ctx.stroke();
      ctx.setLineDash([]);
      this.dimension(a, b, 0, true);
    }
    if (tool === 'calibrate' && this.calib && this.snapped) {
      ctx.strokeStyle = th.window;
      ctx.lineWidth = 2 * px;
      ctx.beginPath(); ctx.moveTo(this.calib.x, this.calib.z); ctx.lineTo(this.snapped.x, this.snapped.z); ctx.stroke();
      this.dimension(this.calib, this.snapped, 0, true);
    }
    if ((tool === 'door' || tool === 'window') && this.cursorScreen.x >= 0) {
      const hit = this.nearestWall(level, this.cursor);
      if (hit) {
        const width = Math.min(tool === 'door' ? this.prefs.doorWidth : this.prefs.windowWidth, wallLength(hit.wall));
        const len = wallLength(hit.wall);
        const off = Math.min(len - width / 2, Math.max(width / 2, hit.offset));
        const { ux, uz } = wallDir(hit.wall);
        ctx.strokeStyle = withAlpha(tool === 'door' ? th.door : th.window, 0.9);
        ctx.lineWidth = hit.wall.thickness + 4 * px;
        ctx.beginPath();
        ctx.moveTo(hit.wall.a.x + ux * (off - width / 2), hit.wall.a.z + uz * (off - width / 2));
        ctx.lineTo(hit.wall.a.x + ux * (off + width / 2), hit.wall.a.z + uz * (off + width / 2));
        ctx.stroke();
      }
    }
    if (tool !== 'select' && this.snapped && this.cursorScreen.x >= 0 && tool !== 'door' && tool !== 'window') {
      ctx.strokeStyle = th.accent;
      ctx.lineWidth = 1.5 * px;
      ctx.beginPath(); ctx.arc(this.snapped.x, this.snapped.z, 5 * px, 0, Math.PI * 2); ctx.stroke();
    }

    // Room labels on top.
    for (const r of level.rooms) {
      const reg = regions.get(r.id);
      const pos = roomLabelPos(level, r.id);
      const selected = sel?.kind === 'room' && sel.id === r.id;
      this.label(pos, r.name, reg?.enclosed ? formatArea(reg.area, view.units) : 'not enclosed', selected, !reg?.enclosed);
    }

    // Walker position / camera marker.
    if (this.pose && this.pose.levelId === level.id && view.mode === 'walk') {
      const { x, z, dirX, dirZ } = this.pose;
      const a = Math.atan2(dirZ, dirX);
      ctx.fillStyle = withAlpha(th.accent, 0.18);
      ctx.beginPath(); ctx.moveTo(x, z); ctx.arc(x, z, 2.2, a - 0.55, a + 0.55); ctx.closePath(); ctx.fill();
      ctx.fillStyle = th.accent;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 * px;
      ctx.beginPath(); ctx.arc(x, z, 6 * px, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();

    this.drawScaleBar(H);
    if (!level.walls.length && !ul) this.drawEmptyHint(W, H);
  }

  private drawGrid(W: number, H: number) {
    const { ctx } = this;
    const th = this.theme;
    const minor = this.scale > 60 ? 0.1 : this.scale > 20 ? 0.5 : 1;
    const major = this.scale > 15 ? 1 : 5;
    const draw = (stepM: number, color: string) => {
      const step = stepM * this.scale;
      if (step < 6) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = ((this.ox % step) + step) % step; x < W; x += step) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, H); }
      for (let y = ((this.oy % step) + step) % step; y < H; y += step) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(W, Math.round(y) + 0.5); }
      ctx.stroke();
    };
    if (minor < major) draw(minor, th.grid);
    draw(major, th.gridMajor);
  }

  private drawOpening(w: Wall, o: Opening, from: number, to: number, selected: boolean) {
    const { ctx } = this;
    const th = this.theme;
    const px = 1 / this.scale;
    const { ux, uz, nx, nz } = wallDir(w);
    const P = (t: number, n = 0) => ({ x: w.a.x + ux * t + nx * n, z: w.a.z + uz * t + nz * n });
    const half = w.thickness / 2;
    const color = selected ? th.accent : o.kind === 'door' ? th.door : o.kind === 'window' ? th.window : th.muted;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(px, 1.2 * px);
    const line = (a: Vec2, b: Vec2) => { ctx.beginPath(); ctx.moveTo(a.x, a.z); ctx.lineTo(b.x, b.z); ctx.stroke(); };
    // Jambs
    line(P(from, -half), P(from, half));
    line(P(to, -half), P(to, half));
    if (o.kind === 'window') {
      line(P(from, -half * 0.35), P(to, -half * 0.35));
      line(P(from, half * 0.35), P(to, half * 0.35));
      if (selected) { ctx.lineWidth = 3 * px; line(P(from, 0), P(to, 0)); }
    } else if (o.kind === 'door') {
      const left = (o.swing ?? 'left') === 'left';
      const side = left ? 1 : -1;
      const total = to - from;
      const leaves = total > 1.25
        ? [{ hingeStart: true, w: total / 2 }, { hingeStart: false, w: total / 2 }]
        : [{ hingeStart: (o.hinge ?? 'start') === 'start', w: total }];
      const open = Math.max(0.15, this.store.view.doorsOpen) * (Math.PI / 2) * 0.95;
      for (const lf of leaves) {
        const hinge = P(lf.hingeStart ? from : to, side * half);
        // Leaf direction: along the wall towards the strike side, rotated into the swing side.
        const along = { x: ux * (lf.hingeStart ? 1 : -1), z: uz * (lf.hingeStart ? 1 : -1) };
        const nrm = { x: nx * side, z: nz * side };
        const leafEnd = {
          x: hinge.x + (along.x * Math.cos(open) + nrm.x * Math.sin(open)) * lf.w,
          z: hinge.z + (along.z * Math.cos(open) + nrm.z * Math.sin(open)) * lf.w,
        };
        ctx.lineWidth = (selected ? 3 : 2) * px;
        line(hinge, leafEnd);
        ctx.lineWidth = px;
        ctx.setLineDash([3 * px, 3 * px]);
        const a0 = Math.atan2(along.z, along.x), a1 = Math.atan2(leafEnd.z - hinge.z, leafEnd.x - hinge.x);
        let d = a1 - a0;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        ctx.beginPath(); ctx.arc(hinge.x, hinge.z, lf.w, a0, a0 + d, d < 0); ctx.stroke();
        ctx.setLineDash([]);
      }
    } else {
      ctx.setLineDash([4 * px, 3 * px]);
      line(P(from, -half), P(to, -half));
      line(P(from, half), P(to, half));
      ctx.setLineDash([]);
    }
  }

  private drawStair(s: Stair, ghost: boolean, selected = false) {
    const { ctx } = this;
    const th = this.theme;
    const px = 1 / this.scale;
    const secs = stairSections(s);
    ctx.save();
    ctx.globalAlpha = ghost ? 0.45 : 1;
    // Climb path through the centre of each section, used for the arrow.
    const path: Vec2[] = [];
    for (const sec of secs) {
      const { hx, hz } = sec.obb;
      ctx.save();
      ctx.translate(sec.obb.cx, sec.obb.cz);
      ctx.rotate(-sec.obb.rot);
      ctx.fillStyle = ghost ? 'transparent' : withAlpha(th.item, 0.9);
      ctx.strokeStyle = selected ? th.accent : th.wall;
      ctx.lineWidth = (selected ? 2.5 : 1.2) * px;
      ctx.fillRect(-hx, -hz, hx * 2, hz * 2);
      ctx.strokeRect(-hx, -hz, hx * 2, hz * 2);
      if (sec.kind === 'flight') {
        const n = Math.max(1, sec.steps);
        ctx.lineWidth = px;
        ctx.beginPath();
        for (let i = 1; i < n; i++) {
          const z = -hz + (hz * 2 * i) / n;
          ctx.moveTo(-hx, z); ctx.lineTo(hx, z);
        }
        ctx.stroke();
      }
      ctx.restore();
      if (sec.kind === 'flight') {
        const [ax, az] = toWorld(sec.obb, 0, -sec.obb.hz + 0.15);
        const [bx, bz] = toWorld(sec.obb, 0, sec.obb.hz - 0.15);
        path.push({ x: ax, z: az }, { x: bx, z: bz });
      } else {
        path.push({ x: sec.obb.cx, z: sec.obb.cz });
      }
    }
    // Arrow pointing up the stairs.
    ctx.strokeStyle = selected ? th.accent : th.door;
    ctx.lineWidth = 1.6 * px;
    ctx.beginPath();
    path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.z) : ctx.moveTo(p.x, p.z)));
    const end = path[path.length - 1], prev = path[path.length - 2] ?? end;
    const a = Math.atan2(end.z - prev.z, end.x - prev.x);
    for (const da of [2.6, -2.6]) {
      ctx.moveTo(end.x, end.z);
      ctx.lineTo(end.x + Math.cos(a + da) * 0.22, end.z + Math.sin(a + da) * 0.22);
    }
    ctx.stroke();
    ctx.restore();
    if (!ghost) {
      const first = secs[0].obb;
      const [x, z] = toWorld(first, 0, -first.hz - 0.2);
      this.text({ x, z }, 'UP', 10, th.door, true);
    }
  }

  private drawItem(it: Item, selected: boolean, hovered: boolean) {
    const { ctx } = this;
    const th = this.theme;
    const px = 1 / this.scale;
    ctx.save();
    ctx.translate(it.x, it.z);
    ctx.rotate(-it.rot);
    const fill = it.type === 'rug' ? withAlpha(it.color, 0.35) : mix(it.color, th.item, 0.6);
    ctx.fillStyle = fill;
    ctx.strokeStyle = selected ? th.accent : hovered ? mix(th.wall, th.accent, 0.5) : withAlpha(th.wall, 0.75);
    ctx.lineWidth = (selected ? 2.5 : 1) * px;
    roundRect(ctx, -it.w / 2, -it.d / 2, it.w, it.d, Math.min(0.05, it.w / 4, it.d / 4));
    ctx.fill();
    ctx.stroke();
    // Front edge marker (local +Z).
    if (it.type !== 'rug' && it.type !== 'plant' && it.type !== 'lamp') {
      ctx.strokeStyle = withAlpha(th.wall, 0.45);
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.moveTo(-it.w / 2 + Math.min(0.08, it.w * 0.2), it.d / 2 - 2 * px);
      ctx.lineTo(it.w / 2 - Math.min(0.08, it.w * 0.2), it.d / 2 - 2 * px);
      ctx.stroke();
    }
    ctx.restore();
    const minSide = Math.min(it.w, it.d) * this.scale;
    if (minSide > 22 || selected) this.text({ x: it.x, z: it.z }, it.name, 10, th.text, false, Math.max(it.w, it.d) * this.scale);
    if (selected) {
      const h = this.rotateHandle(it);
      const [cx, cz] = toWorld(itemObb(it), 0, -it.d / 2);
      ctx.strokeStyle = th.accent;
      ctx.lineWidth = px;
      ctx.beginPath(); ctx.moveTo(cx, cz); ctx.lineTo(h.x, h.z); ctx.stroke();
      this.handle(h, true);
      const dims = `${formatLength(it.w, this.store.view.units)} × ${formatLength(it.d, this.store.view.units)}`;
      const [bx, bz] = toWorld(itemObb(it), 0, it.d / 2 + 14 / this.scale);
      this.text({ x: bx, z: bz }, dims, 10, th.accent, true);
    }
  }

  private handle(p: Vec2, round = false) {
    const { ctx } = this;
    const px = 1 / this.scale;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = this.theme.accent;
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    if (round) ctx.arc(p.x, p.z, 6 * px, 0, Math.PI * 2);
    else ctx.rect(p.x - 5 * px, p.z - 5 * px, 10 * px, 10 * px);
    ctx.fill();
    ctx.stroke();
  }

  private dimension(a: Vec2, b: Vec2, offset: number, plain = false) {
    const len = dist(a, b);
    if (len < 1e-3) return;
    const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
    const mid = { x: (a.x + b.x) / 2 + nx * offset, z: (a.z + b.z) / 2 + nz * offset };
    this.text(mid, formatLength(len, this.store.view.units), 11, plain ? this.theme.text : this.theme.accent, true);
  }

  /** Text in world coordinates, drawn at a constant screen size. */
  private text(p: Vec2, s: string, size: number, color: string, pill = false, maxWidth?: number) {
    const { ctx } = this;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const [x, y] = this.toScreen(p);
    ctx.font = `500 ${size}px Inter, system-ui, sans-serif`;
    let t = s;
    if (maxWidth && textWidth(ctx, t) > maxWidth - 6) {
      while (t.length > 2 && textWidth(ctx, t + '…') > maxWidth - 6) t = t.slice(0, -1);
      t += '…';
      if (t.length <= 2) { ctx.restore(); return; }
    }
    const w = textWidth(ctx, t);
    if (pill) {
      ctx.fillStyle = withAlpha(this.theme.bg, 0.92);
      roundRect(ctx, x - w / 2 - 5, y - size / 2 - 4, w + 10, size + 8, 6);
      ctx.fill();
    }
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t, x, y + 0.5);
    ctx.restore();
  }

  private label(p: Vec2, name: string, sub: string, selected: boolean, warn: boolean) {
    const { ctx } = this;
    const th = this.theme;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const [x, y] = this.toScreen(p);
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    const w1 = textWidth(ctx, name);
    ctx.font = '500 10px Inter, system-ui, sans-serif';
    const w2 = textWidth(ctx, sub);
    const w = Math.max(w1, w2) + 14;
    ctx.fillStyle = selected ? th.accent : withAlpha(th.bg, 0.88);
    roundRect(ctx, x - w / 2, y - 16, w, 32, 8);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = selected ? '#fff' : th.room;
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    ctx.fillText(name, x, y - 5);
    ctx.font = '500 10px Inter, system-ui, sans-serif';
    ctx.fillStyle = selected ? 'rgba(255,255,255,0.85)' : warn ? th.door : th.muted;
    ctx.fillText(sub, x, y + 8);
    ctx.restore();
  }

  private drawScaleBar(H: number) {
    const { ctx } = this;
    const th = this.theme;
    const targets = [0.5, 1, 2, 5, 10, 20, 50];
    const m = targets.find((t) => t * this.scale >= 60) ?? 50;
    const len = m * this.scale;
    const x = 16, y = H - 18;
    ctx.strokeStyle = th.muted;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + len, y); ctx.lineTo(x + len, y - 4);
    ctx.stroke();
    ctx.fillStyle = th.muted;
    ctx.font = '500 10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(formatLength(m, this.store.view.units), x + len / 2, y - 7);
  }

  private drawEmptyHint(W: number, H: number) {
    const { ctx } = this;
    ctx.fillStyle = this.theme.muted;
    ctx.font = '500 13px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('This level is empty.', W / 2, H / 2 - 10);
    ctx.font = '400 12px Inter, system-ui, sans-serif';
    ctx.fillText('Draw walls with W, or import a DWG/DXF/image plan.', W / 2, H / 2 + 10);
  }

  private image(src: string): HTMLImageElement {
    let img = this.images.get(src);
    if (!img) {
      img = new Image();
      img.onload = () => this.invalidate();
      img.src = src;
      this.images.clear();
      this.images.set(src, img);
    }
    return img;
  }
}

/** Where a room's label is drawn: region centroid if enclosed, else its seed. */
function roomLabelPos(level: Level, roomId: string): Vec2 {
  const r = level.rooms.find((x) => x.id === roomId);
  if (!r) return { x: 0, z: 0 };
  const reg = roomRegions(level).get(roomId);
  if (reg?.enclosed && pointInRegion(reg, reg.centroid.x, reg.centroid.z)) return reg.centroid;
  return r.seed;
}


function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, r));
}
