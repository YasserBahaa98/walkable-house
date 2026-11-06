import { uid } from './ids';
import { sampleProject } from './sample';
import { parseProject } from './validate';
import type { Item, Level, Opening, Project, Room, Selection, Stair, Tool, ViewSettings, Wall } from './types';

export type ChangeKind = 'project' | 'view' | 'selection' | 'tool' | 'level' | 'status';
type Listener = (kinds: Set<ChangeKind>) => void;

export const DEFAULT_VIEW: ViewSettings = {
  mode: 'orbit', night: false, sun: 135, quality: 'high', cutaway: false, doorsOpen: 0.85,
  eye: 1.62, showUnderlay: true, underlayOpacity: 0.55, showGrid: true, snap: true, units: 'm', ghostLevel: true, showRoof: false,
};

const HISTORY_LIMIT = 150;
const MERGE_WINDOW_MS = 1200;

/**
 * History entry. Reference drawings can be large, so their JSON is shared
 * between snapshots until it actually changes (same string instance).
 */
interface Snapshot { project: string; underlays: string }

export interface PersistAdapter {
  save(project: Project, view: ViewSettings): Promise<void>;
}

/**
 * Central application state. All edits go through `mutate()` so that every
 * change is undoable, persisted, and broadcast to the views.
 */
export class Store {
  project: Project;
  view: ViewSettings = { ...DEFAULT_VIEW };
  activeLevelId: string;
  selection: Selection | null = null;
  tool: Tool = 'select';
  saveStatus: 'saved' | 'saving' | 'error' = 'saved';

  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private underlayCache: { sig: string; json: string } | null = null;
  private lastMerge: { key: string; at: number } | null = null;
  private listeners = new Set<Listener>();
  private pending = new Set<ChangeKind>();
  private flushScheduled = false;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  persist: PersistAdapter | null = null;

  constructor(project: Project = sampleProject(), view?: Partial<ViewSettings>) {
    this.project = project;
    if (view) this.view = { ...DEFAULT_VIEW, ...view, mode: 'orbit' };
    this.activeLevelId = project.levels[0].id;
  }

  // ---------------------------------------------------------------- events
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Batch change notifications into one microtask so views redraw once. */
  emit(...kinds: ChangeKind[]) {
    kinds.forEach((k) => this.pending.add(k));
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      const set = new Set(this.pending);
      this.pending.clear();
      this.listeners.forEach((fn) => fn(set));
    });
  }

  // --------------------------------------------------------------- getters
  get level(): Level {
    return this.project.levels.find((l) => l.id === this.activeLevelId) ?? this.project.levels[0];
  }
  get levelIndex(): number { return Math.max(0, this.project.levels.indexOf(this.level)); }
  levelBelow(level = this.level): Level | undefined {
    const sorted = this.sortedLevels();
    const i = sorted.indexOf(level);
    return i > 0 ? sorted[i - 1] : undefined;
  }
  levelAbove(level = this.level): Level | undefined {
    const sorted = this.sortedLevels();
    const i = sorted.indexOf(level);
    return i >= 0 && i < sorted.length - 1 ? sorted[i + 1] : undefined;
  }
  sortedLevels(): Level[] { return [...this.project.levels].sort((a, b) => a.elevation - b.elevation); }

  /**
   * Add a storey on top of the house (one undo step) and make it active. The
   * roof moves up from the old top level, so it never cuts through the new one.
   */
  addLevelOnTop(make: (top: Level, id: string) => Omit<Level, 'id'>): string {
    const id = uid('L');
    this.mutate((p) => {
      const top = [...p.levels].sort((a, b) => a.elevation - b.elevation).at(-1)!;
      const level: Level = { ...make(top, id), id };
      if (top.roof && !level.roof) { level.roof = top.roof; delete top.roof; }
      p.levels.push(level);
    });
    this.setLevel(id);
    return id;
  }

  find(sel: Selection | null = this.selection, level = this.level): Wall | Opening | Room | Item | Stair | undefined {
    if (!sel) return undefined;
    const list: { id: string }[] = {
      wall: level.walls, opening: level.openings, room: level.rooms, item: level.items, stair: level.stairs,
    }[sel.kind];
    return list.find((x) => x.id === sel.id) as Wall | Opening | Room | Item | Stair | undefined;
  }
  wall(id: string, level = this.level) { return level.walls.find((w) => w.id === id); }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  // ------------------------------------------------------------- mutations
  /**
   * Apply an undoable change to the project. Consecutive mutations with the same
   * `mergeKey` within a short window collapse into one undo step (drags, typing).
   */
  mutate(fn: (p: Project, level: Level) => void, mergeKey?: string) {
    const now = Date.now();
    const merge = mergeKey && this.lastMerge && this.lastMerge.key === mergeKey && now - this.lastMerge.at < MERGE_WINDOW_MS;
    if (!merge) {
      this.undoStack.push(this.snapshot());
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    }
    this.redoStack = [];
    this.lastMerge = mergeKey ? { key: mergeKey, at: now } : null;
    fn(this.project, this.level);
    this.afterProjectChange();
  }

  /** End a merge group explicitly (e.g. on pointer up) so the next edit is a new step. */
  endMerge() { this.lastMerge = null; }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.snapshot());
    this.restore(prev);
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshot());
    this.restore(next);
  }

  /** Replace the whole project (import, new). Clears history. */
  load(project: Project, keepHistory = false) {
    if (keepHistory) this.undoStack.push(this.snapshot());
    else this.undoStack = [];
    this.redoStack = [];
    this.project = project;
    this.activeLevelId = project.levels[0].id;
    this.selection = null;
    this.tool = 'select';
    this.afterProjectChange();
    this.emit('level', 'selection', 'tool');
  }

  select(sel: Selection | null) {
    if (sel?.kind === this.selection?.kind && sel?.id === this.selection?.id) return;
    this.selection = sel;
    this.emit('selection');
  }

  setTool(tool: Tool) {
    if (this.tool === tool) return;
    this.tool = tool;
    if (tool !== 'select') this.selection = null;
    this.emit('tool', 'selection');
  }

  setLevel(id: string) {
    if (!this.project.levels.some((l) => l.id === id) || id === this.activeLevelId) return;
    this.activeLevelId = id;
    this.selection = null;
    this.emit('level', 'selection');
  }

  setView(patch: Partial<ViewSettings>) {
    Object.assign(this.view, patch);
    this.emit('view');
    this.scheduleSave();
  }

  deleteSelection() {
    const sel = this.selection;
    if (!sel) return;
    this.mutate((_p, level) => {
      if (sel.kind === 'wall') {
        level.walls = level.walls.filter((w) => w.id !== sel.id);
        level.openings = level.openings.filter((o) => o.wallId !== sel.id);
      } else if (sel.kind === 'opening') level.openings = level.openings.filter((o) => o.id !== sel.id);
      else if (sel.kind === 'room') level.rooms = level.rooms.filter((r) => r.id !== sel.id);
      else if (sel.kind === 'item') level.items = level.items.filter((i) => i.id !== sel.id);
      else level.stairs = level.stairs.filter((s) => s.id !== sel.id);
    });
    this.selection = null;
    this.emit('selection');
  }

  duplicateSelection() {
    const sel = this.selection;
    if (!sel || (sel.kind !== 'item' && sel.kind !== 'stair')) return;
    const src = this.find(sel) as Item | Stair | undefined;
    if (!src) return;
    const copy = { ...src, id: uid(sel.kind === 'item' ? 'i' : 's'), x: src.x + 0.3, z: src.z + 0.3 };
    this.mutate((_p, level) => {
      if (sel.kind === 'item') level.items.push(copy as Item);
      else level.stairs.push(copy as Stair);
    });
    this.select({ kind: sel.kind, id: copy.id });
  }

  // --------------------------------------------------------------- layouts
  /** Save current furniture of all levels as a named layout and make it active. */
  saveLayout(name: string): string {
    const id = uid('lay');
    this.mutate((p) => {
      p.layouts.push({ id, name, items: this.captureItems() });
      p.activeLayoutId = id;
    });
    return id;
  }

  switchLayout(id: string) {
    const target = this.project.layouts.find((l) => l.id === id);
    if (!target || id === this.project.activeLayoutId) return;
    this.mutate((p) => {
      const current = p.layouts.find((l) => l.id === p.activeLayoutId);
      if (current) current.items = this.captureItems();
      for (const level of p.levels) {
        level.items = structuredClone(target.items[level.id] ?? []);
      }
      p.activeLayoutId = id;
    });
    this.selection = null;
    this.emit('selection');
  }

  deleteLayout(id: string) {
    this.mutate((p) => {
      p.layouts = p.layouts.filter((l) => l.id !== id);
      if (p.activeLayoutId === id) p.activeLayoutId = null;
    });
  }

  private captureItems(): Record<string, Item[]> {
    return Object.fromEntries(this.project.levels.map((l) => [l.id, structuredClone(l.items)]));
  }

  // -------------------------------------------------------------- internal
  private snapshot(): Snapshot {
    const { underlays, ...rest } = this.project;
    const sig = underlaySignature(underlays);
    if (!this.underlayCache || this.underlayCache.sig !== sig) this.underlayCache = { sig, json: JSON.stringify(underlays) };
    return { project: JSON.stringify(rest), underlays: this.underlayCache.json };
  }

  private restore(snap: Snapshot) {
    const restored = parseProject({ ...JSON.parse(snap.project), underlays: JSON.parse(snap.underlays) });
    this.project = restored;
    this.underlayCache = null;
    if (!restored.levels.some((l) => l.id === this.activeLevelId)) {
      this.activeLevelId = restored.levels[0].id;
      this.emit('level');
    }
    if (this.selection && !this.find()) this.selection = null;
    this.lastMerge = null;
    this.afterProjectChange();
    this.emit('selection');
  }

  private afterProjectChange() {
    this.emit('project');
    this.scheduleSave();
  }

  private scheduleSave() {
    if (!this.persist) return;
    this.saveStatus = 'saving';
    this.emit('status');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.persist!.save(this.project, this.view)
        .then(() => { this.saveStatus = 'saved'; })
        .catch(() => { this.saveStatus = 'error'; })
        .finally(() => this.emit('status'));
    }, 600);
  }
}

/** Cheap change detector for reference drawings (avoids re-serialising them on every edit). */
function underlaySignature(u: Project['underlays']): string {
  return Object.entries(u).map(([k, v]) => {
    if (v.kind === 'image') return `${k}:i:${v.x}:${v.z}:${v.scale}:${v.dataUrl.length}`;
    const s = v.segments;
    let h = s.length;
    const step = Math.max(1, Math.floor(s.length / 64));
    for (let i = 0; i < s.length; i += step) h = (h * 31 + Math.round(s[i] * 1000)) | 0;
    return `${k}:c:${s.length}:${h}`;
  }).join('|');
}

/** Builder for an empty storey stacked on `top` (for `Store.addLevelOnTop`). */
export function emptyLevelAbove(count: number) {
  return (top: Level): Omit<Level, 'id'> => ({
    name: `Level ${count + 1}`, elevation: Math.round((top.elevation + top.height + 0.3) * 1000) / 1000, height: top.height,
    walls: [], openings: [], rooms: [], items: [], stairs: [],
  });
}
