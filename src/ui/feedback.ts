import { h, icon } from './dom';

let region: HTMLElement | null = null;

/** Non-blocking notification, announced to screen readers. */
export function toast(message: string, kind: 'info' | 'error' | 'success' = 'info', ms = 4200) {
  if (!region) {
    region = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(region);
  }
  const el = h('div', { class: `toast toast-${kind}` },
    icon(kind === 'error' ? 'warning' : kind === 'success' ? 'check' : 'info', 16),
    h('span', {}, message));
  region.append(el);
  const remove = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 200); };
  const timer = setTimeout(remove, kind === 'error' ? ms * 1.6 : ms);
  el.addEventListener('click', () => { clearTimeout(timer); remove(); });
}

/** Full-pane busy indicator with a message; returns a function that hides it. */
export function busy(message: string): () => void {
  const el = h('div', { class: 'busy', role: 'alert', 'aria-busy': 'true' },
    h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('div', { class: 'busy-text' }, message));
  document.body.append(el);
  return () => el.remove();
}

interface DialogOptions {
  title: string;
  body: Node | string;
  actions: { label: string; value: string; primary?: boolean; danger?: boolean }[];
  wide?: boolean;
  /** Called before closing with a non-cancel value; return false to keep the dialog open. */
  validate?: (value: string) => boolean;
}

/** Modal dialog built on <dialog> (focus trapping and Esc handled natively). */
export function dialog(opts: DialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: `modal${opts.wide ? ' modal-wide' : ''}`, 'aria-labelledby': 'dlg-title' });
    const form = h('form', { method: 'dialog' });
    const footer = h('div', { class: 'modal-actions' });
    for (const a of opts.actions) {
      footer.append(h('button', {
        class: `btn${a.primary ? ' btn-primary' : ''}${a.danger ? ' btn-danger' : ''}`,
        value: a.value, type: 'submit', ...(a.primary ? { autofocus: true } : {}),
      }, a.label));
    }
    form.append(
      h('div', { class: 'modal-head' },
        h('h2', { id: 'dlg-title' }, opts.title),
        h('button', { class: 'icon-btn', type: 'submit', value: '', 'aria-label': 'Close' }, icon('x'))),
      h('div', { class: 'modal-body' }, opts.body),
      footer,
    );
    dlg.append(form);
    form.addEventListener('submit', (e) => {
      const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
      const value = submitter?.value ?? '';
      if (value && opts.validate && !opts.validate(value)) { e.preventDefault(); }
    });
    dlg.addEventListener('close', () => {
      const v = dlg.returnValue;
      dlg.remove();
      resolve(v ? v : null);
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export async function confirmDialog(title: string, message: string, confirm = 'Continue', danger = false): Promise<boolean> {
  const r = await dialog({
    title, body: h('p', {}, message),
    actions: [{ label: 'Cancel', value: '' }, { label: confirm, value: 'ok', primary: !danger, danger }],
  });
  return r === 'ok';
}

export async function promptDialog(title: string, label: string, initial = '', hint?: string): Promise<string | null> {
  const input = h('input', { class: 'input', value: initial, 'aria-label': label, autofocus: true, required: true });
  const body = h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'field-hint' }, hint) : null);
  const r = await dialog({ title, body, actions: [{ label: 'Cancel', value: '' }, { label: 'OK', value: 'ok', primary: true }], validate: () => input.value.trim().length > 0 });
  return r === 'ok' ? input.value.trim() : null;
}
