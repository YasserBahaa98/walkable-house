import type { Units } from '../model/types';
import { parseLength, toUnit, unitLabel } from '../model/units';
import { clamp, round3 as round } from '../geometry/math';
import { h, icon, iconButton } from './dom';

/**
 * Form controls bound to model values. Each control registers a refresher so
 * the panel can update values in place (keeping focus) instead of re-rendering.
 */
export class FieldKit {
  private refreshers: (() => void)[] = [];

  constructor(private units: () => Units) {}

  /** Forget controls from a previous render. */
  reset() { this.refreshers = []; }

  /** Update every control from the model (skips the one being edited). */
  refresh() { this.refreshers.forEach((r) => r()); }

  /** Inspector header whose title follows the edited object's name. */
  liveHeader(title: () => string, ic: Parameters<typeof icon>[0], onDelete: () => void): HTMLElement {
    const el = header(title(), ic, onDelete);
    const t = el.querySelector('.inspector-title')!;
    this.refreshers.push(() => { t.textContent = title(); });
    return el;
  }

  length(label: string, get: () => number, set: (v: number) => void, min: number, max: number, hint?: string): HTMLElement {
    const units = this.units();
    const input = h('input', { class: 'input', inputmode: 'decimal', 'aria-label': `${label} (${unitLabel(units)})`, spellcheck: 'false' });
    const show = () => { if (document.activeElement !== input) input.value = String(toUnit(get(), units)); };
    const commit = () => {
      const v = parseLength(input.value, units);
      if (v === null || !Number.isFinite(v)) { input.classList.add('invalid'); return; }
      input.classList.remove('invalid');
      set(clamp(v, min, max));
      input.value = String(toUnit(clamp(v, min, max), units));
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { commit(); input.select(); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const stepM = e.shiftKey ? 0.1 : units === 'ft' ? 0.0254 : 0.01;
        const v = clamp(get() + (e.key === 'ArrowUp' ? stepM : -stepM), min, max);
        set(round(v));
        input.value = String(toUnit(v, units));
      }
    });
    input.addEventListener('blur', () => { input.classList.remove('invalid'); show(); });
    show();
    this.refreshers.push(show);
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label),
      h('span', { class: 'input-unit' }, input, h('span', { class: 'unit' }, unitLabel(units))),
      hint ? h('span', { class: 'field-hint' }, hint) : null);
  }

  number(label: string, unit: string, get: () => number, set: (v: number) => void, min: number, max: number, step: number): HTMLElement {
    const input = h('input', { class: 'input', type: 'number', step: String(step), min: String(min), max: String(max), 'aria-label': label });
    const show = () => { if (document.activeElement !== input) input.value = String(get()); };
    input.addEventListener('input', () => { const v = parseFloat(input.value); if (Number.isFinite(v)) set(clamp(v, min, max)); });
    show();
    this.refreshers.push(show);
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), h('span', { class: 'input-unit' }, input, h('span', { class: 'unit' }, unit)));
  }

  text(label: string, get: () => string, set: (v: string) => void): HTMLElement {
    const input = h('input', { class: 'input', 'aria-label': label, maxlength: 80 });
    const show = () => { if (document.activeElement !== input) input.value = get(); };
    input.addEventListener('input', () => set(input.value.trim()));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    show();
    this.refreshers.push(show);
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input);
  }

  color(label: string, get: () => string, set: (v: string) => void): HTMLElement {
    const input = h('input', { class: 'color', type: 'color', 'aria-label': label });
    const show = () => { if (document.activeElement !== input) input.value = get(); };
    input.addEventListener('input', () => set(input.value));
    show();
    this.refreshers.push(show);
    return h('label', { class: 'field field-inline' }, h('span', { class: 'field-label' }, label), input);
  }

  toggle(label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
    const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch' });
    const show = () => { input.checked = get(); };
    input.addEventListener('change', () => set(input.checked));
    show();
    this.refreshers.push(show);
    return h('label', { class: 'toggle' }, h('span', {}, label), input);
  }

  slider(label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string): HTMLElement {
    const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': label, class: 'range' });
    const out = h('output', { class: 'range-value' });
    const show = () => { if (document.activeElement !== input) input.value = String(get()); out.textContent = fmt(get()); };
    input.addEventListener('input', () => { set(parseFloat(input.value)); out.textContent = fmt(parseFloat(input.value)); });
    show();
    this.refreshers.push(show);
    return h('label', { class: 'field' }, h('span', { class: 'field-label field-label-row' }, label, out), input);
  }
}

export function section(title: string, children: Node[]): HTMLElement {
  return h('section', { class: 'section' }, h('h3', { class: 'section-title' }, title), ...children);
}

export function header(title: string, ic: Parameters<typeof icon>[0], onDelete: () => void): HTMLElement {
  return h('div', { class: 'inspector-head' },
    h('span', { class: 'inspector-icon' }, icon(ic, 18)),
    h('h2', { class: 'inspector-title' }, title),
    iconButton('trash', 'Delete', onDelete, 'Del', { class: 'icon-btn danger' }));
}

export function stat(label: string, value: string): HTMLElement {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, value), h('span', { class: 'stat-label' }, label));
}

export function segmented(options: { id: string; label: string }[], value: string, onChange: (id: string) => void): HTMLElement {
  const group = h('div', { class: 'segmented', role: 'radiogroup' });
  for (const o of options) {
    group.append(h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(o.id === value), class: o.id === value ? 'on' : '',
      onclick: () => onChange(o.id),
    }, o.label));
  }
  return group;
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
