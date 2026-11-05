/// <reference lib="webworker" />
// Parses DWG/DXF files off the main thread with LibreDWG compiled to WebAssembly.
import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';
import { flattenDatabase, type RawDatabase } from './cadParse';

let lib: Promise<LibreDwg> | null = null;

self.onmessage = async (ev: MessageEvent<{ id: number; name: string; data: ArrayBuffer }>) => {
  const { id, name, data } = ev.data;
  try {
    lib ??= LibreDwg.create();
    const libredwg = await lib;
    const isDxf = /\.dxf$/i.test(name);
    const raw = libredwg.dwg_read_data(data, isDxf ? Dwg_File_Type.DXF : Dwg_File_Type.DWG);
    if (!raw) throw new Error('The file could not be read. It may be corrupt or an unsupported CAD version.');
    const db = libredwg.convert(raw) as unknown as RawDatabase;
    libredwg.dwg_free(raw);
    const drawing = flattenDatabase(db, name);
    if (!drawing.segments.length) throw new Error('No linework found in this drawing.');
    (self as unknown as Worker).postMessage({ id, ok: true, drawing });
  } catch (err) {
    lib = null; // a failed wasm instance may be in a bad state; start fresh next time
    (self as unknown as Worker).postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
