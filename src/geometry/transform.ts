import type { Level, Project, Vec2 } from '../model/types';
import { round3 } from './math';

/** Scale a level's geometry (and reference drawing) uniformly around point `o`. */
export function scaleLevel(p: Project, l: Level, o: Vec2, k: number) {
  const sp = (q: Vec2): Vec2 => ({ x: round3(o.x + (q.x - o.x) * k), z: round3(o.z + (q.z - o.z) * k) });
  for (const w of l.walls) { w.a = sp(w.a); w.b = sp(w.b); }
  for (const op of l.openings) { op.offset *= k; op.width *= k; }
  for (const r of l.rooms) r.seed = sp(r.seed);
  for (const it of l.items) { const q = sp(it); it.x = q.x; it.z = q.z; }
  for (const s of l.stairs) { const q = sp(s); s.x = q.x; s.z = q.z; s.length *= k; s.width *= k; }
  const ul = p.underlays[l.id];
  if (ul?.kind === 'cad') {
    // New array (not in place) so caches keyed on the array see the change.
    const seg = ul.segments.slice();
    for (let i = 0; i < seg.length; i += 2) {
      const q = sp({ x: seg[i], z: seg[i + 1] });
      seg[i] = q.x; seg[i + 1] = q.z;
    }
    ul.segments = seg;
  } else if (ul?.kind === 'image') {
    const q = sp({ x: ul.x, z: ul.z });
    ul.x = q.x; ul.z = q.z; ul.scale *= k;
  }
}
