/// <reference lib="webworker" />
// Parses CAD files off the main thread: DWG with LibreDWG (WebAssembly),
// DXF with dxf-parser. Both produce the same flattened drawing.
import { flattenDatabase, type RawDatabase } from './cadParse';
import { parseDxf } from './dxf';
import type { LibreDwg } from '@mlightcad/libredwg-web';

let lib: Promise<LibreDwg> | null = null;

async function readDwg(data: ArrayBuffer): Promise<RawDatabase> {
  const mod = await import('@mlightcad/libredwg-web');
  lib ??= mod.LibreDwg.create();
  const libredwg = await lib;
  const raw = libredwg.dwg_read_data(data, mod.Dwg_File_Type.DWG);
  if (!raw) throw new Error('The DWG file could not be read. It may be corrupt or from an unsupported AutoCAD version.');
  try {
    return libredwg.convert(raw) as unknown as RawDatabase;
  } finally {
    libredwg.dwg_free(raw);
  }
}

self.onmessage = async (ev: MessageEvent<{ id: number; name: string; data: ArrayBuffer }>) => {
  const { id, name, data } = ev.data;
  try {
    const db = /\.dxf$/i.test(name)
      ? parseDxf(new TextDecoder().decode(data))
      : await readDwg(data);
    const drawing = flattenDatabase(db, name);
    if (!drawing.segments.length) throw new Error('No linework found in this drawing.');
    (self as unknown as Worker).postMessage({ id, ok: true, drawing });
  } catch (err) {
    lib = null; // a failed wasm instance may be in a bad state; start fresh next time
    (self as unknown as Worker).postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
