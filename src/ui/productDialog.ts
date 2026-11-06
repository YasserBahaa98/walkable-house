import { h, icon } from './dom';
import { fitToType, parseProduct, PRODUCT_TYPES, type ProductSpec } from '../import/product';
import { FINISH_LABELS, PART_LABELS, STYLE_FIELDS, TYPE_LABELS, type StyleKey } from '../model/styles';

const cm = (m: number) => `${Math.round(m * 100)}`;

/**
 * "Add from product details": the user pastes a product's name and
 * measurements (or an item description from Claude), checks what was read,
 * and adds it. Runs entirely in the browser. Resolves to the item spec, or
 * null if cancelled.
 */
export function productDialog(): Promise<ProductSpec | null> {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'modal modal-wide product-dialog', 'aria-labelledby': 'pd-title' });
    const body = h('div', { class: 'modal-body' });
    const actions = h('div', { class: 'modal-actions' });
    const close = (v: ProductSpec | null) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.append(
      h('div', { class: 'modal-head' },
        h('h2', { id: 'pd-title' }, 'Add from product details'),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => close(null) }, icon('x'))),
      body, actions);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });

    // ------------------------------------------------------------ step 1
    const text = h('textarea', {
      class: 'input textarea', rows: 9, 'aria-label': 'Product details', spellcheck: 'false',
      placeholder: 'POÄNG\nArmchair, birch veneer/Knisa light beige\nWidth: 68 cm\nDepth: 82 cm\nHeight: 100 cm',
    });
    const error = h('p', { class: 'warn small', role: 'alert' });
    const step1 = () => {
      body.replaceChildren(
        h('p', { class: 'small' }, 'On the product page, copy the name and the measurements (on IKEA: “Measurements” under the product) and paste them here. Rows like “Width: 68 cm” or “68 × 82 × 100 cm” both work.'),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Product details'), text),
        h('p', { class: 'small muted' }, 'You can also paste an item description that Claude wrote for you in a chat.'),
        error);
      actions.replaceChildren(
        h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: read }, 'Read details'));
      text.focus();
    };
    const read = () => {
      error.textContent = '';
      if (!text.value.trim()) { error.textContent = 'Paste the product name and its measurements first.'; return; }
      try { step2(parseProduct(text.value)); } catch (e) { error.textContent = e instanceof Error ? e.message : 'That could not be read.'; }
    };

    // ------------------------------------------------------------ step 2
    const step2 = (spec: ProductSpec) => {
      const name = h('input', { class: 'input', value: spec.name, 'aria-label': 'Name' });
      const type = h('select', { class: 'input', 'aria-label': 'Type' },
        ...PRODUCT_TYPES.map((t) => h('option', { value: t, selected: t === spec.type }, TYPE_LABELS[t])));
      const dim = (label: string, v: number) => h('input', { class: 'input', type: 'number', min: '1', max: '1200', step: '1', value: cm(v), 'aria-label': `${label} (cm)` });
      const w = dim('Width', spec.w), d = dim('Depth', spec.d), ht = dim('Height', spec.h);
      const styleBits = Object.entries(spec.style ?? {}).map(([k, v]) => {
        const f = STYLE_FIELDS[k as StyleKey];
        return f.kind === 'count' ? `${v} ${f.label.toLowerCase()}` : f.options.find((o) => o.id === v)?.label.toLowerCase() ?? String(v);
      });
      const partBits = Object.entries(spec.parts ?? {}).map(([p, s]) => `${PART_LABELS[p as keyof typeof PART_LABELS].toLowerCase()}: ${[s?.finish && FINISH_LABELS[s.finish].toLowerCase(), s?.color].filter(Boolean).join(' ')}`);
      body.replaceChildren(
        h('div', { class: 'product-summary' },
          h('span', { class: 'color-chip', style: `background:${spec.color}` }),
          h('div', {},
            h('strong', {}, TYPE_LABELS[spec.type]),
            h('p', { class: 'small' }, [spec.finish ? FINISH_LABELS[spec.finish] : null, ...styleBits].filter(Boolean).join(' · ') || 'Default style'),
            ...(partBits.length ? [h('p', { class: 'small' }, partBits.join(' · '))] : []))),
        h('div', { class: 'grid-2' },
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name'), name),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Type'), type)),
        h('div', { class: 'grid-3' },
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Width (cm)'), w),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Depth (cm)'), d),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Height (cm)'), ht)),
        h('p', { class: spec.sizeSource === 'listed' ? 'small' : 'warn small' },
          spec.sizeSource === 'listed' ? 'Measurements read from what you pasted.' : 'Some measurements are estimated. Check them against the product.'),
        ...(spec.notes ? [h('p', { class: 'small muted' }, spec.notes)] : []),
        h('p', { class: 'small muted' }, 'Width is side to side seen from the front. You can change the style, colour and materials in the inspector after adding it.'));
      const num = (el: HTMLInputElement, fallback: number) => {
        const v = parseFloat(el.value);
        return Number.isFinite(v) && v > 0 ? Math.min(1200, v) / 100 : fallback;
      };
      actions.replaceChildren(
        h('button', { class: 'btn', type: 'button', onclick: () => step1() }, 'Back'),
        h('button', {
          class: 'btn btn-primary', type: 'button',
          onclick: () => {
            const t = type.value as ProductSpec['type'];
            const fitted = t === spec.type ? spec : fitToType(spec, t);
            close({ ...fitted, name: name.value.trim() || spec.name, w: num(w, spec.w), d: num(d, spec.d), h: num(ht, spec.h) });
          },
        }, 'Add to plan'));
      name.focus();
    };

    document.body.append(dlg);
    dlg.showModal();
    step1();
  });
}
