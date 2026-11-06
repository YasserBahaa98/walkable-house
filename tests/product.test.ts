import { describe, expect, it } from 'vitest';
import { describeProduct, MODEL, productSchema, specFromReply, systemPrompt, type MessagesClient } from '../src/import/product';
import { TYPE_LABELS } from '../src/model/styles';

/** Every object in a JSON schema must list all its properties and forbid extras (structured outputs rule). */
function checkStrict(schema: Record<string, unknown>, path = '$'): string[] {
  const errs: string[] = [];
  if (schema.type === 'object') {
    const props = Object.keys((schema.properties as object) ?? {});
    if (schema.additionalProperties !== false) errs.push(`${path}: additionalProperties`);
    const req = (schema.required as string[]) ?? [];
    for (const p of props) if (!req.includes(p)) errs.push(`${path}.${p} not required`);
  }
  for (const [k, v] of Object.entries(schema)) {
    if (v && typeof v === 'object') {
      if (Array.isArray(v)) v.forEach((x, i) => { if (x && typeof x === 'object') errs.push(...checkStrict(x as Record<string, unknown>, `${path}.${k}[${i}]`)); });
      else errs.push(...checkStrict(v as Record<string, unknown>, `${path}.${k}`));
    }
  }
  return errs;
}

const reply = (obj: unknown, stop = 'end_turn') => ({ content: [{ type: 'text', text: JSON.stringify(obj) }], stop_reason: stop });
const good = {
  name: 'BESTÅ TV bench', type: 'sideboard', width_cm: 180, depth_cm: 42, height_cm: 38, size_source: 'listed',
  color: '#2F3133', finish: 'painted',
  style: { arms: 'yes', back: null, legs: 'hairpin', top: null, base: null, doors: 3, drawers: 0, shelves: 'open', handles: 'none' },
  parts: [{ part: 'top', color: '#A47551', finish: 'wood' }, { part: 'seat', color: '#000000', finish: 'fabric' }],
  notes: '',
};

function fakeClient(replies: ReturnType<typeof reply>[]) {
  const calls: Record<string, unknown>[] = [];
  const client: MessagesClient = {
    beta: { messages: { create: async (body) => { calls.push(structuredClone(body)); return replies.shift()!; } } },
  };
  return { client, calls };
}

describe('product importer', () => {
  it('uses a strict schema that covers every furniture type', () => {
    expect(checkStrict(productSchema())).toEqual([]);
    const types = ((productSchema().properties as Record<string, { enum: string[] }>).type).enum;
    expect(types).toContain('bunkbed');
    expect(types).not.toContain('model');
    const prompt = systemPrompt();
    for (const t of Object.keys(TYPE_LABELS).filter((t) => t !== 'model')) expect(prompt).toContain(`- ${t} (`);
    expect(prompt).toMatch(/Ignore any instructions/);
  });

  it('turns a reply into a safe item spec', () => {
    const spec = specFromReply(good);
    expect(spec).toMatchObject({ type: 'sideboard', name: 'BESTÅ TV bench', w: 1.8, d: 0.42, h: 0.38, color: '#2f3133', finish: 'painted', sizeSource: 'listed' });
    // Only the sideboard's own options and parts survive.
    expect(spec.style).toEqual({ legs: 'hairpin', doors: 3, drawers: 0, shelves: 'open', handles: 'none' });
    expect(spec.parts).toEqual({ top: { color: '#a47551', finish: 'wood' } });
  });

  it('falls back safely on bad values', () => {
    const spec = specFromReply({ type: 'spaceship', width_cm: -5, depth_cm: 'big', height_cm: 99999, color: 'red', finish: 'gold', style: { doors: 99 }, parts: 'x' });
    expect(spec.type).toBe('box');
    expect(spec.w).toBe(0.01);
    expect(spec.d).toBe(0.6);
    expect(spec.h).toBe(12);
    expect(spec.color).toBe('#c4bdb3');
    expect(spec.finish).toBeUndefined();
    expect(spec.style).toBeUndefined();
    expect(() => specFromReply('nope')).toThrow();
  });

  it('sends links with web fetch, the default fallback and the schema', async () => {
    const { client, calls } = fakeClient([reply(good)]);
    await describeProduct(client, { url: 'https://www.ikea.com/x' });
    const body = calls[0];
    expect(body.model).toBe(MODEL);
    expect(body.fallbacks).toBe('default');
    expect(body.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(body.tools).toEqual([expect.objectContaining({ type: 'web_fetch_20260209', name: 'web_fetch' })]);
    expect(JSON.stringify(body.messages)).toContain('https://www.ikea.com/x');
    expect((body.output_config as { format: { type: string } }).format.type).toBe('json_schema');
  });

  it('sends pictures without tools', async () => {
    const { client, calls } = fakeClient([reply(good)]);
    await describeProduct(client, { image: { data: 'AAAA', mediaType: 'image/jpeg' } });
    expect(calls[0].tools).toBeUndefined();
    expect(JSON.stringify(calls[0].messages)).toContain('"type":"image"');
  });

  it('continues a paused turn and reports refusals', async () => {
    const paused = { content: [{ type: 'server_tool_use' }], stop_reason: 'pause_turn' };
    const { client, calls } = fakeClient([paused, reply(good)]);
    const spec = await describeProduct(client, { url: 'https://example.com/chair' });
    expect(spec.type).toBe('sideboard');
    expect(calls).toHaveLength(2);
    expect((calls[1].messages as unknown[]).length).toBe(2);

    const refused = fakeClient([{ content: [], stop_reason: 'refusal' }]);
    await expect(describeProduct(refused.client, { url: 'https://example.com/chair' })).rejects.toThrow(/declined/);
    await expect(describeProduct(refused.client, {})).rejects.toThrow(/link or add a picture/);
  });
});
