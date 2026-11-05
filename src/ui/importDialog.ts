import type { Project } from '../model/types';
import type { CadDrawing } from '../importer/cadTypes';
import { buildProject, extract, type Extraction, guessScale, guessWallLayers, UNIT_SCALES } from '../importer/extract';
import { openingSpans, wallDir } from '../geometry/walls';
import { h } from './dom';
import { dialog } from './feedback';

const LEVEL_NAMES = ['Ground floor', 'First floor', 'Second floor', 'Third floor', 'Fourth floor', 'Fifth floor'];

export interface CadImportResult { project: Project; mode: 'replace' | 'append' }

/**
 * Interactive CAD import: detect floors/walls/doors/rooms, let the user correct
 * units, wall layers and floor assignment with a live preview, then build a project.
 */
export async function cadImportDialog(d: CadDrawing, canAppend: boolean): Promise<CadImportResult | null> {
  let wallLayers = guessWallLayers(d);
  let scale = guessScale(d, wallLayers);
  wallLayers = guessWallLayers(d, scale);
  let assignment: (number | null)[] = [];
  let floorHeight = 3.0;
  let furniture = true;
  let underlay = true;
  let mode: 'replace' | 'append' = 'replace';
  let ex: Extraction = { floors: [], warnings: [] };

  const canvas = h('canvas', { class: 'import-preview', width: 640, height: 420, role: 'img', 'aria-label': 'Preview of detected floor plans' });
  const stats = h('p', { class: 'import-stats', 'aria-live': 'polite' });
  const floorsBox = h('div', { class: 'import-floors' });
  const warnBox = h('div', { class: 'import-warn' });

  const run = () => {
    try {
      ex = extract(d, { scale, wallLayers, minThickness: 0.07, maxThickness: 0.6 });
    } catch (err) {
      ex = { floors: [], warnings: [err instanceof Error ? err.message : 'Detection failed.'] };
    }
    if (assignment.length !== ex.floors.length) assignment = ex.floors.map((_, i) => (i < LEVEL_NAMES.length ? i : null));
    renderFloors();
    renderStats();
    draw();
  };

  const renderStats = () => {
    const f = ex.floors.filter((_, i) => assignment[i] !== null);
    const sum = (fn: (x: Extraction['floors'][number]) => number) => f.reduce((s, x) => s + fn(x), 0);
    stats.textContent = ex.floors.length
      ? `${f.length} floor${f.length === 1 ? '' : 's'} · ${sum((x) => x.walls.length)} walls · ${sum((x) => x.openings.filter((o) => o.kind === 'door').length)} doors · ${sum((x) => x.openings.filter((o) => o.kind === 'window').length)} windows · ${sum((x) => x.rooms.length)} room labels · ${sum((x) => x.items.length)} furniture · ${sum((x) => x.stairs.length)} stairs`
      : 'No floor plan detected with these settings.';
    const warnings = [...d.warnings, ...ex.warnings];
    warnBox.replaceChildren(...warnings.map((w) => h('p', { class: 'warn small' }, w)));
  };

  const renderFloors = () => {
    floorsBox.replaceChildren(...ex.floors.map((f, i) => {
      const sel = h('select', { class: 'input', 'aria-label': `Plan ${i + 1} becomes` },
        ...LEVEL_NAMES.map((n, k) => h('option', { value: String(k), selected: assignment[i] === k }, n)),
        h('option', { value: 'skip', selected: assignment[i] === null }, 'Skip'));
      sel.addEventListener('change', () => { assignment[i] = sel.value === 'skip' ? null : +sel.value; renderStats(); draw(); });
      const w = (f.bounds.maxX - f.bounds.minX).toFixed(1), dd = (f.bounds.maxZ - f.bounds.minZ).toFixed(1);
      return h('label', { class: 'field' },
        h('span', { class: 'field-label' }, h('span', { class: 'plan-badge' }, String(i + 1)), ` Plan ${i + 1} · ${w} × ${dd} m`), sel);
    }));
  };

  const draw = () => {
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    const css = getComputedStyle(document.documentElement);
    ctx.fillStyle = css.getPropertyValue('--plan-bg').trim() || '#fbfaf8';
    ctx.fillRect(0, 0, W, H);
    if (!ex.floors.length) return;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const f of ex.floors) {
      minX = Math.min(minX, f.bounds.minX); maxX = Math.max(maxX, f.bounds.maxX);
      minZ = Math.min(minZ, f.bounds.minZ); maxZ = Math.max(maxZ, f.bounds.maxZ);
    }
    const pad = 24;
    const k = Math.min((W - pad * 2) / Math.max(1, maxX - minX), (H - pad * 2) / Math.max(1, maxZ - minZ));
    const ox = pad + ((W - pad * 2) - (maxX - minX) * k) / 2 - minX * k;
    const oz = pad + ((H - pad * 2) - (maxZ - minZ) * k) / 2 - minZ * k;
    ctx.save();
    ctx.translate(ox, oz);
    ctx.scale(k, k);
    const muted = css.getPropertyValue('--muted').trim() || '#888';
    ex.floors.forEach((f, i) => {
      const skipped = assignment[i] === null;
      ctx.globalAlpha = skipped ? 0.25 : 1;
      ctx.strokeStyle = muted;
      ctx.globalAlpha *= 0.35;
      ctx.lineWidth = 1 / k;
      ctx.beginPath();
      const u = f.underlay;
      for (let j = 0; j < u.length; j += 4) { ctx.moveTo(u[j], u[j + 1]); ctx.lineTo(u[j + 2], u[j + 3]); }
      ctx.stroke();
      ctx.globalAlpha = skipped ? 0.25 : 1;
      ctx.strokeStyle = css.getPropertyValue('--plan-wall').trim() || '#333';
      for (const w of f.walls) {
        ctx.lineWidth = Math.max(w.thickness, 2 / k);
        ctx.beginPath(); ctx.moveTo(w.a.x, w.a.z); ctx.lineTo(w.b.x, w.b.z); ctx.stroke();
        for (const s of openingSpans(w, f.openings)) {
          const { ux, uz } = wallDir(w);
          ctx.strokeStyle = s.opening.kind === 'door' ? '#d0592e' : s.opening.kind === 'window' ? '#2f7fc1' : '#d9a21b';
          ctx.lineWidth = Math.max(w.thickness + 0.06, 3 / k);
          ctx.beginPath();
          ctx.moveTo(w.a.x + ux * s.from, w.a.z + uz * s.from);
          ctx.lineTo(w.a.x + ux * s.to, w.a.z + uz * s.to);
          ctx.stroke();
          ctx.strokeStyle = css.getPropertyValue('--plan-wall').trim() || '#333';
        }
      }
      ctx.fillStyle = 'rgba(232,70,124,0.25)';
      for (const { stair } of f.stairs) {
        ctx.save(); ctx.translate(stair.x, stair.z); ctx.rotate(-stair.rot);
        ctx.fillRect(-stair.width / 2, -stair.length / 2, stair.width, stair.length);
        ctx.restore();
      }
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = skipped ? 0.4 : 1;
      const [bx, by] = [f.bounds.minX * k + ox, f.bounds.minZ * k + oz];
      ctx.fillStyle = '#e8467c';
      ctx.beginPath(); ctx.arc(bx, by - 2, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '600 12px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), bx, by - 1.5);
      ctx.restore();
      ctx.save();
      ctx.translate(ox, oz);
      ctx.scale(k, k);
    });
    ctx.restore();
  };

  // Controls
  const unitSel = h('select', { class: 'input', 'aria-label': 'Drawing units' },
    ...UNIT_SCALES.map((u) => h('option', { value: String(u.scale), selected: u.scale === scale }, u.label)));
  unitSel.addEventListener('change', () => { scale = +unitSel.value; run(); });

  const layerList = h('div', { class: 'layer-list' }, ...d.layers.slice(0, 60).map((l) => {
    const cb = h('input', { type: 'checkbox', checked: wallLayers.includes(l.name) });
    cb.addEventListener('change', () => {
      wallLayers = cb.checked ? [...wallLayers, l.name] : wallLayers.filter((x) => x !== l.name);
      run();
    });
    return h('label', { class: 'layer' }, cb, h('span', { class: 'layer-name' }, l.name), h('span', { class: 'layer-count' }, l.count.toLocaleString()));
  }));

  const heightIn = h('input', { class: 'input', type: 'number', min: '2.2', max: '6', step: '0.05', value: String(floorHeight), 'aria-label': 'Floor-to-floor height in metres' });
  heightIn.addEventListener('change', () => { const v = parseFloat(heightIn.value); if (v >= 2.2 && v <= 6) floorHeight = v; });
  const furnCb = h('input', { type: 'checkbox', checked: true, role: 'switch', class: 'switch' });
  furnCb.addEventListener('change', () => { furniture = furnCb.checked; });
  const ulCb = h('input', { type: 'checkbox', checked: true, role: 'switch', class: 'switch' });
  ulCb.addEventListener('change', () => { underlay = ulCb.checked; });
  const modeSel = h('select', { class: 'input', 'aria-label': 'Import mode' },
    h('option', { value: 'replace' }, 'Replace current project'),
    h('option', { value: 'append', disabled: !canAppend }, 'Add as new levels'));
  modeSel.addEventListener('change', () => { mode = modeSel.value as 'replace' | 'append'; });

  const body = h('div', { class: 'import-grid' },
    h('div', { class: 'import-left' }, canvas, stats, warnBox,
      h('p', { class: 'muted small legend' },
        h('span', { class: 'lg lg-wall' }), 'walls ', h('span', { class: 'lg lg-door' }), 'doors ', h('span', { class: 'lg lg-window' }), 'windows ',
        h('span', { class: 'lg lg-pass' }), 'passages ', h('span', { class: 'lg lg-stair' }), 'stairs')),
    h('div', { class: 'import-right' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Drawing units'), unitSel),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Wall layers'), layerList,
        h('span', { class: 'field-hint' }, 'Layers whose double lines are walls. Auto-detected; adjust if walls are missing.')),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Detected plans'), floorsBox),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Floor-to-floor height (m)'), heightIn),
      h('label', { class: 'toggle' }, h('span', {}, 'Import furniture blocks'), furnCb),
      h('label', { class: 'toggle' }, h('span', {}, 'Keep drawing as reference'), ulCb),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Import into'), modeSel)));

  run();
  let result: Project | null = null;
  const choice = await dialog({
    title: `Import ${d.fileName}`,
    body,
    wide: true,
    actions: [{ label: 'Cancel', value: '' }, { label: 'Import', value: 'ok', primary: true }],
    validate: () => {
      try {
        result = buildProject(ex, {
          name: d.fileName.replace(/\.(dwg|dxf)$/i, ''), assignment, floorHeight, includeFurniture: furniture, keepUnderlay: underlay,
        });
        return true;
      } catch (err) {
        stats.textContent = err instanceof Error ? err.message : 'Nothing to import.';
        stats.classList.add('warn');
        return false;
      }
    },
  });
  if (choice !== 'ok' || !result) return null;
  return { project: result, mode };
}
