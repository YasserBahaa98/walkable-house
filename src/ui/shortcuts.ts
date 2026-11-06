import type { Store } from '../model/store';
import type { PlanView } from '../view2d/PlanView';
import type { View3D } from '../view3d/View3D';
import { TOOLS } from './tools';

export interface ShortcutHost {
  store: Store;
  plan: PlanView;
  view3d(): View3D | null;
  help(): void;
  walk(): void;
  exportProject(): void;
  openFile(): Promise<void>;
}

/** Global keyboard shortcuts (ignored while typing in a field or when a dialog is open). */
export function bindShortcuts(host: ShortcutHost) {
    const s = host.store;
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      const typing = /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (document.querySelector('dialog[open]')) return;
      if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); s.redo(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); host.exportProject(); return; }
      if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); void host.openFile(); return; }
      if (mod && e.key.toLowerCase() === 'd' && !typing) { e.preventDefault(); s.duplicateSelection(); return; }
      if (typing || mod || e.altKey) return;
      const walking = s.view.mode === 'walk';
      if (e.key === 'Escape') {
        if (host.plan.cancel()) return;
        if (s.tool !== 'select') { s.setTool('select'); return; }
        if (s.selection) { s.select(null); return; }
        if (walking) s.setView({ mode: 'orbit' });
        return;
      }
      if (e.key === 'Enter' && s.tool === 'wall') { host.plan.finishDraft(); return; }
      if (e.key === ' ' && !walking) { host.plan.setSpace(true); if (t === host.plan.canvas) e.preventDefault(); return; }
      if (walking && ['w', 'a', 's', 'd'].includes(e.key.toLowerCase())) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection) { e.preventDefault(); s.deleteSelection(); return; }
      if (e.key === '?') { host.help(); return; }
      if (e.key === '1') { s.setView({ mode: 'orbit' }); return; }
      if (e.key === '2') { host.walk(); return; }
      if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        const next = e.key === 'PageUp' ? s.levelAbove() : s.levelBelow();
        if (next) s.setLevel(next.id);
        return;
      }
      const tool = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (tool && !walking) { s.setTool(tool.id); return; }
      if (e.key.toLowerCase() === 'f') { host.plan.fit(); host.view3d()?.frame(); return; }
      if (e.key.toLowerCase() === 'l') { s.setView({ night: !s.view.night }); return; }
      if (e.key.toLowerCase() === 't') { s.setView({ showRoof: !s.view.showRoof }); return; }
      if (e.key === '+' || e.key === '=') { host.plan.zoomBy(1.25); return; }
      if (e.key === '-') { host.plan.zoomBy(0.8); return; }
      const sel = s.selection;
      if (sel && (sel.kind === 'item' || sel.kind === 'stair')) {
        if (e.key.toLowerCase() === 'q' || e.key.toLowerCase() === 'e') {
          const step = (e.shiftKey ? Math.PI / 2 : Math.PI / 12) * (e.key.toLowerCase() === 'q' ? 1 : -1);
          s.mutate((_p, l) => {
            const obj = (sel.kind === 'item' ? l.items : l.stairs).find((x) => x.id === sel.id);
            if (obj) obj.rot = Math.round((obj.rot + step) * 1000) / 1000;
          }, `rot-${sel.id}`);
          return;
        }
        const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        const a = arrows[e.key];
        if (a && document.activeElement !== host.view3d()?.renderer.domElement) {
          e.preventDefault();
          const d = e.shiftKey ? 0.5 : 0.05;
          s.mutate((_p, l) => {
            const obj = (sel.kind === 'item' ? l.items : l.stairs).find((x) => x.id === sel.id);
            if (obj) { obj.x = Math.round((obj.x + a[0] * d) * 1000) / 1000; obj.z = Math.round((obj.z + a[1] * d) * 1000) / 1000; }
          }, `nudge-${sel.id}`);
        }
      }
    });
    window.addEventListener('keyup', (e) => { if (e.key === ' ') host.plan.setSpace(false); });
}
