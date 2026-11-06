import { describe, expect, it, vi } from 'vitest';
import { emptyLevelAbove, Store } from '../src/model/store';
import { sampleProject } from '../src/model/sample';
import { parseProject } from '../src/model/validate';

describe('Store', () => {
  it('moves the roof up to a newly added top level, as one undo step', () => {
    const s = new Store(sampleProject());
    const top = s.sortedLevels().at(-1)!;
    const roof = top.roof;
    expect(roof).toBeDefined();
    const id = s.addLevelOnTop(emptyLevelAbove(s.project.levels.length));
    expect(s.activeLevelId).toBe(id);
    expect(s.level.roof).toEqual(roof);
    expect(s.project.levels.find((l) => l.id === top.id)!.roof).toBeUndefined();
    expect(s.level.elevation).toBeGreaterThan(top.elevation + top.height);
    s.undo();
    expect(s.project.levels).toHaveLength(2);
    expect(s.project.levels.find((l) => l.id === top.id)!.roof).toEqual(roof);
  });

  it('undoes and redoes mutations', () => {
    const s = new Store(sampleProject());
    const before = s.level.items.length;
    s.mutate((_p, l) => { l.items.pop(); });
    expect(s.level.items.length).toBe(before - 1);
    s.undo();
    expect(s.level.items.length).toBe(before);
    s.redo();
    expect(s.level.items.length).toBe(before - 1);
  });

  it('merges continuous edits (drags) into one undo step', () => {
    const s = new Store(sampleProject());
    const it0 = s.level.items[0];
    const x0 = it0.x;
    for (let i = 1; i <= 10; i++) s.mutate((_p, l) => { l.items[0].x = x0 + i * 0.1; }, 'drag:1');
    s.endMerge();
    s.undo();
    expect(s.level.items[0].x).toBeCloseTo(x0);
  });

  it('deleting a wall removes its openings', () => {
    const s = new Store(sampleProject());
    const w = s.level.walls.find((x) => s.level.openings.some((o) => o.wallId === x.id))!;
    s.select({ kind: 'wall', id: w.id });
    s.deleteSelection();
    expect(s.level.openings.some((o) => o.wallId === w.id)).toBe(false);
    expect(s.selection).toBeNull();
  });

  it('switches furniture layouts without touching walls', () => {
    const s = new Store(sampleProject());
    const walls = JSON.stringify(s.level.walls);
    const a = s.saveLayout('A');
    s.mutate((_p, l) => { l.items = []; });
    const b = s.saveLayout('B');
    s.switchLayout(a);
    expect(s.level.items.length).toBeGreaterThan(0);
    s.switchLayout(b);
    expect(s.level.items.length).toBe(0);
    expect(JSON.stringify(s.level.walls)).toBe(walls);
  });

  it('batches notifications into a single microtask', async () => {
    const s = new Store(sampleProject());
    const fn = vi.fn();
    s.subscribe(fn);
    s.select({ kind: 'item', id: s.level.items[0].id });
    s.setView({ night: true });
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
    expect([...fn.mock.calls[0][0]]).toEqual(expect.arrayContaining(['selection', 'view']));
  });

  it('undoes changes to reference drawings together with the plan', () => {
    const p = sampleProject();
    p.underlays[p.levels[0].id] = { kind: 'cad', segments: [0, 0, 1, 1] };
    const s = new Store(p);
    s.mutate((proj, l) => {
      l.name = 'Renamed';
      const ul = proj.underlays[l.id];
      if (ul.kind === 'cad') ul.segments = ul.segments.map((v) => v * 2);
    });
    s.undo();
    expect(s.level.name).toBe('Ground floor');
    expect(s.project.underlays[s.level.id]).toEqual({ kind: 'cad', segments: [0, 0, 1, 1] });
    s.redo();
    expect(s.project.underlays[s.level.id]).toEqual({ kind: 'cad', segments: [0, 0, 2, 2] });
  });
});

describe('parseProject', () => {
  it('round-trips the sample project', () => {
    const p = sampleProject();
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('rejects non-projects with a readable message', () => {
    expect(() => parseProject(null)).toThrow(/does not contain a project/);
    expect(() => parseProject({ levels: [] })).toThrow(/no levels/);
  });

  it('drops dangling openings and clamps bad values', () => {
    const p = parseProject({
      levels: [{
        walls: [{ id: 'w', a: { x: 0, z: 0 }, b: { x: 3, z: 0 }, thickness: -5 }],
        openings: [{ wallId: 'w', kind: 'door', offset: 1, width: 0.9 }, { wallId: 'nope', kind: 'door' }],
        items: [{ type: 'unicorn', x: 'NaN', w: 1e9, color: 'red' }],
      }],
    });
    const l = p.levels[0];
    expect(l.walls[0].thickness).toBe(0.02);
    expect(l.openings).toHaveLength(1);
    expect(l.items[0]).toMatchObject({ type: 'box', x: 0, w: 50, color: '#c4bdb3' });
  });

  it('only accepts image data URLs as image underlays', () => {
    const p = parseProject({
      levels: [{ id: 'L' }],
      underlays: { L: { kind: 'image', dataUrl: 'javascript:alert(1)' } },
    });
    expect(p.underlays.L).toBeUndefined();
  });
});
