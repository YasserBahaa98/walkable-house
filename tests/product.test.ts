import { describe, expect, it } from 'vitest';
import { fitToType, parseProduct, specFromJson, specFromText } from '../src/import/product';

describe('product details from pasted text', () => {
  it('reads an IKEA measurements block', () => {
    const spec = specFromText(`POÄNG
Armchair, birch veneer/Knisa light beige
£120
Width: 68 cm
Depth: 82 cm
Height: 100 cm
Seat width: 56 cm
Seat depth: 49 cm
Seat height: 39 cm`);
    expect(spec).toMatchObject({ type: 'armchair', name: 'POÄNG Armchair', w: 0.68, d: 0.82, h: 1, sizeSource: 'listed' });
    // Upholstered: the cover colour (after the slash) wins over the frame.
    expect(spec.color).toBe('#d9cbb3');
    expect(spec.finish).toBe('fabric');
  });

  it('reads a size triple with a unit at the end', () => {
    const spec = specFromText('BESTÅ TV bench, black-brown\n180x42x38 cm');
    expect(spec).toMatchObject({ type: 'sideboard', w: 1.8, d: 0.42, h: 0.38, color: '#3a2e28', sizeSource: 'listed' });
  });

  it('reads lettered triples, millimetres and inches', () => {
    expect(specFromText('Oak dining table\nH 750 x W 1800 x D 900 mm')).toMatchObject({ type: 'table', w: 1.8, d: 0.9, h: 0.75, finish: 'wood' });
    const us = specFromText('KALLAX Shelf unit, white\nWidth: 30 3/8 "\nDepth: 15 ⅜ "\nHeight: 57 7/8 "');
    expect(us).toMatchObject({ type: 'shelving', color: '#f1efea' });
    expect(us.w).toBeCloseTo(0.77, 2);
    expect(us.h).toBeCloseTo(1.47, 2);
  });

  it('maps bed length to depth and a diameter to a round top', () => {
    const bed = specFromText('MALM Bed frame, high, white\nLength: 209 cm\nWidth: 156 cm\nHeadboard height: 100 cm');
    expect(bed).toMatchObject({ type: 'bed', w: 1.56, d: 2.09, sizeSource: 'estimated' });
    expect(bed.notes).toMatch(/height/);
    const table = specFromText('DOCKSTA Table, white\nDiameter: 103 cm\nHeight: 75 cm');
    expect(table).toMatchObject({ type: 'table', w: 1.03, d: 1.03, h: 0.75, style: { top: 'round' }, sizeSource: 'listed' });
  });

  it('falls back to a labelled box with typical sizes', () => {
    const spec = specFromText('Grand piano, black lacquer');
    expect(spec).toMatchObject({ type: 'box', name: 'Grand piano, black lacquer', sizeSource: 'estimated', color: '#262626', finish: 'painted' });
    expect(() => specFromText('   \n  ')).toThrow();
  });
});

describe('item descriptions in JSON', () => {
  const good = {
    name: 'BESTÅ TV bench', type: 'sideboard', width_cm: 180, depth_cm: 42, height_cm: 38, size_source: 'listed',
    color: '#2F3133', finish: 'painted',
    style: { arms: 'yes', legs: 'hairpin', doors: 3, drawers: 0, shelves: 'open', handles: 'none' },
    parts: { top: { color: '#A47551', finish: 'wood' }, seat: { color: '#000000' } },
  };

  it('keeps only what applies to the type', () => {
    const spec = specFromJson(good);
    expect(spec).toMatchObject({ type: 'sideboard', w: 1.8, d: 0.42, h: 0.38, color: '#2f3133', finish: 'painted', sizeSource: 'listed' });
    expect(spec.style).toEqual({ legs: 'hairpin', doors: 3, drawers: 0, shelves: 'open', handles: 'none' });
    expect(spec.parts).toEqual({ top: { color: '#a47551', finish: 'wood' } });
    expect(specFromJson({ ...good, parts: [{ part: 'legs', color: '#111111', finish: 'metal' }] }).parts).toEqual({ legs: { color: '#111111', finish: 'metal' } });
  });

  it('falls back safely on bad values', () => {
    const spec = specFromJson({ type: 'spaceship', width_cm: -5, depth_cm: 'big', height_cm: 99999, color: 'red', finish: 'gold', style: { doors: 99 }, parts: 'x' });
    expect(spec).toMatchObject({ type: 'box', w: 0.01, d: 0.6, h: 12, color: '#c4bdb3' });
    expect(spec.finish).toBeUndefined();
    expect(spec.style).toBeUndefined();
    expect(() => specFromJson([])).toThrow();
  });

  it('is recognised when pasted, also inside a code block', () => {
    expect(parseProduct('```json\n' + JSON.stringify(good) + '\n```').type).toBe('sideboard');
    expect(() => parseProduct('{"name": "half')).toThrow(/incomplete/);
  });

  it('drops options when the type is changed', () => {
    const spec = fitToType(specFromJson(good), 'tv');
    expect(spec.style).toBeUndefined();
    expect(spec.parts).toBeUndefined();
    expect(spec.elevation).toBe(0.9);
  });
});
