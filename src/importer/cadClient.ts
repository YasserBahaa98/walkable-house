import type { CadDrawing } from './cadTypes';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (d: CadDrawing) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./cad.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; drawing?: CadDrawing; error?: string }>) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      pending.delete(ev.data.id);
      if (ev.data.ok && ev.data.drawing) p.resolve(ev.data.drawing);
      else p.reject(new Error(ev.data.error ?? 'Unknown error while reading the drawing.'));
    };
    worker.onerror = (ev) => {
      const err = new Error(ev.message || 'The CAD reader crashed.');
      pending.forEach((p) => p.reject(err));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

/** Parse a DWG or DXF file in a background worker. */
export function readCadFile(file: File, timeoutMs = 120_000): Promise<CadDrawing> {
  return file.arrayBuffer().then((data) => new Promise<CadDrawing>((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Reading the drawing took too long.'));
    }, timeoutMs);
    pending.set(id, {
      resolve: (d) => { clearTimeout(timer); resolve(d); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    getWorker().postMessage({ id, name: file.name, data }, [data]);
  }));
}
