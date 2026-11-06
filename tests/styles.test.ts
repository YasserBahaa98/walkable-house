import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { FurnitureType, Item } from '../src/model/types';
import { FINISHES, resolveStyle, STYLE_FIELDS, styleKeys, TYPE_LABELS, TYPE_PARTS, type ItemStyle } from '../src/model/styles';
import { parseItem } from '../src/model/validate';
import { guessFurniture, CATALOG } from '../src/model/catalog';
import { buildFurniture } from '../src/view3d/furniture';

const base = (type: FurnitureType, extra: Partial<Item> = {}): Item => {
  const c = CATALOG.find((e) => e.type === type);
  return { id: 'i', type, name: c?.name ?? type, x: 0, z: 0, rot: 0, w: c?.w ?? 0.8, d: c?.d ?? 0.6, h: c?.h ?? 0.8, color: c?.color ?? '#a47551', ...extra };
};

function bounds(it: Item) {
  const g = buildFurniture(it);
  g.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(g);
}

/** Pieces whose parts deliberately reach past the item's height (headboards, taps, mirrors…). */
const TALLER = new Set<FurnitureType>(['bed', 'sink', 'counter']);

describe('styled furniture', () => {
  const types = Object.keys(TYPE_LABELS).filter((t) => t !== 'model') as FurnitureType[];

  it.each(types)('%s builds inside its footprint', (type) => {
    const it = base(type);
    const b = bounds(it);
    expect(b.isEmpty()).toBe(false);
    const tol = type === 'plant' ? 0.06 : 0.03; // leaves spill a little
    expect(b.max.x - b.min.x).toBeLessThanOrEqual(it.w + tol);
    expect(b.max.z - b.min.z).toBeLessThanOrEqual(it.d + tol);
    expect(b.min.y).toBeGreaterThanOrEqual(-1e-3);
    if (!TALLER.has(type)) expect(b.max.y).toBeLessThanOrEqual(it.h + tol);
  });

  it('builds every style option of every type', () => {
    for (const type of types) {
      for (const key of styleKeys(type)) {
        const f = STYLE_FIELDS[key];
        const values = f.kind === 'count' ? [f.min, Math.min(f.max, 3), f.max] : f.options.map((o) => o.id);
        for (const v of values) {
          const it = base(type, { style: { [key]: v } as ItemStyle });
          const b = bounds(it);
          expect(b.isEmpty(), `${type} ${key}=${v}`).toBe(false);
          expect(b.max.x - b.min.x, `${type} ${key}=${v}`).toBeLessThanOrEqual(it.w + 0.05);
          expect(b.max.z - b.min.z, `${type} ${key}=${v}`).toBeLessThanOrEqual(it.d + 0.05);
        }
      }
    }
  });

  it('builds every finish for the main colour and each part', () => {
    for (const type of ['chair', 'sofa', 'sideboard', 'table', 'box'] as FurnitureType[]) {
      for (const finish of FINISHES) {
        const parts = Object.fromEntries((TYPE_PARTS[type] ?? []).map((p) => [p, { finish, color: '#556677' }]));
        expect(bounds(base(type, { finish, parts })).isEmpty()).toBe(false);
      }
    }
  });

  it('adds parts for doors and drawers', () => {
    const count = (style: ItemStyle) => {
      let n = 0;
      buildFurniture(base('sideboard', { style })).traverse((o) => { if (o instanceof THREE.Mesh) n++; });
      return n;
    };
    expect(count({ doors: 4, drawers: 4 })).toBeGreaterThan(count({ doors: 2, drawers: 0 }));
    expect(count({ doors: 2, drawers: 0, handles: 'none' })).toBeLessThan(count({ doors: 2, drawers: 0, handles: 'bar' }));
  });

  it('sizes door and drawer counts to the piece unless set', () => {
    expect(resolveStyle(base('wardrobe', { w: 2.0 })).doors).toBe(4);
    expect(resolveStyle(base('wardrobe', { w: 2.0, style: { doors: 2 } })).doors).toBe(2);
    expect(resolveStyle(base('dresser', { w: 1.4, h: 0.9 })).drawers).toBe(8);
    expect(resolveStyle(base('chair')).back).toBe('solid');
  });
});

describe('style validation', () => {
  it('keeps valid style, finish and parts and drops the rest', () => {
    const it = parseItem({
      type: 'chair', finish: 'leather', style: { arms: 'yes', legs: 'hairpin', doors: 99, back: 'wobbly' },
      parts: { legs: { finish: 'wood', color: '#8a6748' }, seat: { finish: 'fabric', color: 'grey' }, wheels: { finish: 'metal' } },
    });
    expect(it.finish).toBe('leather');
    expect(it.style).toEqual({ arms: 'yes', legs: 'hairpin' });
    expect(it.parts).toEqual({ legs: { finish: 'wood', color: '#8a6748' }, seat: { finish: 'fabric' } });
  });

  it('accepts the new furniture types', () => {
    for (const t of ['sideboard', 'stool', 'ottoman', 'bunkbed', 'dresser', 'shelving']) expect(parseItem({ type: t }).type).toBe(t);
    expect(parseItem({ type: 'spaceship' }).type).toBe('box');
  });
});

describe('guessing types from names', () => {
  it.each([
    ['TV unit', 'sideboard'], ['Sideboard', 'sideboard'], ['Bar stool', 'stool'], ['Footstool', 'ottoman'], ['Pouf', 'ottoman'],
    ['Bunk bed', 'bunkbed'], ['Chest of drawers', 'dresser'], ['MALM dresser', 'dresser'], ['Shelving unit', 'shelving'],
    ['Double bed', 'bed'], ['Dining chair', 'chair'],
  ])('%s → %s', (name, type) => {
    expect(guessFurniture(name).type).toBe(type);
  });
});
