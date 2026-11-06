import { h, icon } from './dom';
import { describeProduct, type ProductInput, type ProductSpec } from '../import/product';
import { explainError, forgetKey, makeClient, savedKey, saveKey } from '../import/client';
import { FINISH_LABELS, PART_LABELS, STYLE_FIELDS, TYPE_LABELS, type StyleKey } from '../model/styles';

/** Longest side sent to the API; larger pictures cost more and don't help. */
const MAX_SIDE = 1568;

/** Downscale and re-encode a picture as JPEG (base64, without the data: prefix). */
async function encodeImage(file: Blob): Promise<NonNullable<ProductInput['image']>> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * s));
  c.height = Math.max(1, Math.round(bmp.height * s));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return { data: c.toDataURL('image/jpeg', 0.88).split(',')[1], mediaType: 'image/jpeg' };
}

const cm = (m: number) => `${Math.round(m * 100)}`;

/**
 * "Add from photo or link": collects a product URL and/or picture, asks
 * Claude to describe it, and lets the user check the result before adding.
 * Resolves to the item spec, or null if cancelled.
 */
export function productDialog(): Promise<ProductSpec | null> {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'modal modal-wide product-dialog', 'aria-labelledby': 'pd-title' });
    const body = h('div', { class: 'modal-body' });
    const actions = h('div', { class: 'modal-actions' });
    const close = (v: ProductSpec | null) => { abort?.abort(); dlg.close(); dlg.remove(); resolve(v); };
    dlg.append(
      h('div', { class: 'modal-head' },
        h('h2', { id: 'pd-title' }, 'Add from photo or link'),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => close(null) }, icon('x'))),
      body, actions);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    let abort: AbortController | null = null;

    // ------------------------------------------------------------ step 1
    let image: ProductInput['image'];
    const url = h('input', { class: 'input', type: 'url', placeholder: 'https://www.ikea.com/…', 'aria-label': 'Product link', autocomplete: 'off' });
    const hint = h('input', { class: 'input', placeholder: 'e.g. the 3-seat version, in oak', 'aria-label': 'Note (optional)' });
    const preview = h('img', { class: 'drop-preview', alt: '', hidden: true });
    const dropText = h('span', {}, 'Drop a picture or screenshot here, paste it (Ctrl+V), or ');
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
    const pick = h('button', { class: 'link-btn', type: 'button', onclick: () => file.click() }, 'choose a file');
    const clearImg = h('button', { class: 'link-btn', type: 'button', hidden: true, onclick: () => setImage(null) }, 'Remove picture');
    const drop = h('div', { class: 'drop-zone', tabindex: 0, role: 'button', 'aria-label': 'Add a picture' },
      preview, h('p', { class: 'small' }, dropText, pick, '.'), clearImg, file);
    const setImage = async (blob: Blob | null) => {
      if (!blob) { image = undefined; preview.hidden = true; clearImg.hidden = true; return; }
      try {
        image = await encodeImage(blob);
        preview.src = `data:image/jpeg;base64,${image.data}`;
        preview.hidden = false;
        clearImg.hidden = false;
      } catch { error.textContent = 'That file could not be read as a picture.'; }
    };
    file.addEventListener('change', () => { if (file.files?.[0]) void setImage(file.files[0]); });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault(); drop.classList.remove('over');
      const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.type.startsWith('image/'));
      if (f) void setImage(f);
    });
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
    dlg.addEventListener('paste', (e) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
      if (f) { e.preventDefault(); void setImage(f); }
    });

    const keyInput = h('input', { class: 'input', type: 'password', placeholder: 'sk-ant-…', 'aria-label': 'Anthropic API key', autocomplete: 'off', spellcheck: 'false' });
    const remember = h('input', { type: 'checkbox', checked: true });
    const keyBox = h('div', { class: 'key-box' });
    const renderKey = () => {
      keyBox.replaceChildren();
      if (savedKey()) {
        keyBox.append(h('p', { class: 'small' }, icon('check', 14), ' Using the API key saved in this browser. ',
          h('button', { class: 'link-btn', type: 'button', onclick: () => { forgetKey(); renderKey(); } }, 'Forget it')));
      } else {
        keyBox.append(
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Anthropic API key'), keyInput,
            h('span', { class: 'field-hint' }, 'Get one at console.anthropic.com. It is kept only in this browser and sent only to Anthropic; each item costs a few cents on your account.')),
          h('label', { class: 'toggle small' }, remember, h('span', {}, 'Remember on this device')));
      }
    };
    const error = h('p', { class: 'warn small', role: 'alert' });

    const step1 = () => {
      body.replaceChildren(
        h('p', { class: 'small' }, 'Paste a link to a product page (IKEA or any shop), add a picture, or both. Claude reads the size, colours, materials and style and builds a matching piece.'),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Product link'), url),
        drop,
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Note (optional)'), hint),
        keyBox, error);
      renderKey();
      actions.replaceChildren(
        h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => void run() }, 'Describe item'));
      url.focus();
    };

    // ------------------------------------------------------------ step 2
    const run = async () => {
      error.textContent = '';
      const link = url.value.trim();
      if (link && !/^https?:\/\/\S+\.\S+/i.test(link)) { error.textContent = 'The link should start with http:// or https://.'; return; }
      if (!link && !image) { error.textContent = 'Paste a link or add a picture first.'; return; }
      const key = savedKey() || keyInput.value.trim();
      if (!key) { error.textContent = 'Enter your Anthropic API key.'; keyInput.focus(); return; }
      if (!savedKey() && remember.checked) saveKey(key);
      abort = new AbortController();
      body.replaceChildren(h('div', { class: 'working' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }),
        h('p', {}, link ? 'Reading the product page…' : 'Looking at the picture…'),
        h('p', { class: 'small muted' }, 'This usually takes 10–40 seconds.')));
      actions.replaceChildren(h('button', { class: 'btn', type: 'button', onclick: () => { abort?.abort(); } }, 'Cancel'));
      try {
        const client = await makeClient(key);
        const spec = await describeProduct(client, { url: link || undefined, image, hint: hint.value }, abort.signal);
        step3(spec);
      } catch (e) {
        const err = await explainError(e);
        if (err.kind === 'auth') forgetKey();
        step1();
        error.textContent = err.message;
      } finally {
        abort = null;
      }
    };

    // ------------------------------------------------------------ step 3
    const step3 = (spec: ProductSpec) => {
      const name = h('input', { class: 'input', value: spec.name, 'aria-label': 'Name' });
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
            partBits.length ? h('p', { class: 'small' }, partBits.join(' · ')) : null)),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name'), name),
        h('div', { class: 'grid-3' },
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Width (cm)'), w),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Depth (cm)'), d),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Height (cm)'), ht)),
        h('p', { class: spec.sizeSource === 'listed' ? 'small' : 'warn small' },
          spec.sizeSource === 'listed' ? 'Measurements taken from the product listing.' : 'Measurements are estimated. Check them against the product.'),
        ...(spec.notes ? [h('p', { class: 'small muted' }, spec.notes)] : []),
        h('p', { class: 'small muted' }, 'You can change the style and materials in the inspector after adding it.'));
      const num = (el: HTMLInputElement, fallback: number) => {
        const v = parseFloat(el.value);
        return Number.isFinite(v) && v > 0 ? Math.min(1200, v) / 100 : fallback;
      };
      actions.replaceChildren(
        h('button', { class: 'btn', type: 'button', onclick: () => step1() }, 'Back'),
        h('button', {
          class: 'btn btn-primary', type: 'button',
          onclick: () => close({ ...spec, name: name.value.trim() || spec.name, w: num(w, spec.w), d: num(d, spec.d), h: num(ht, spec.h) }),
        }, 'Add to plan'));
    };

    document.body.append(dlg);
    dlg.showModal();
    step1();
  });
}

