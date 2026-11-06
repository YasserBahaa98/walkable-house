import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { kvGet, kvSet } from './model/persistence';
import { sampleProject } from './model/sample';
import { Store } from './model/store';
import type { Project, ViewSettings } from './model/types';
import { parseProject } from './model/validate';
import { App } from './ui/App';
import { toast } from './ui/feedback';

async function boot() {
  const mount = document.getElementById('app')!;
  let project: Project | null = null;
  let view: Partial<ViewSettings> | undefined;
  let storageOk = true;
  let firstRun = false;
  let unreadable = false;
  try {
    const saved = await kvGet<unknown>('project');
    view = (await kvGet<Partial<ViewSettings>>('view')) ?? undefined;
    if (!saved) firstRun = true;
    else {
      try {
        project = parseProject(saved);
      } catch (err) {
        unreadable = true;
        console.warn('Saved project is unreadable', err);
      }
    }
  } catch (err) {
    storageOk = false;
    console.warn('Browser storage unavailable', err);
  }

  const store = new Store(project ?? sampleProject(), view);
  if (storageOk) {
    store.persist = {
      save: async (p, v) => {
        await kvSet('project', p);
        await kvSet('view', v);
      },
    };
  }
  const app = new App(store, mount);
  document.getElementById('boot')?.remove();

  if (!storageOk) toast('Browser storage is unavailable (private mode?). Export your project to keep your work.', 'error', 8000);
  if (unreadable) toast('Your saved project could not be read, so the demo house was loaded instead.', 'error', 8000);
  if (firstRun && storageOk) void app.welcome();

  window.addEventListener('error', (e) => toast(`Something went wrong: ${e.message}`, 'error'));
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
    toast(`Something went wrong: ${msg}`, 'error');
  });

  // Offline support. In dev the service worker is disabled by the plugin.
  registerSW({
    immediate: true,
    onOfflineReady: () => toast('Ready to work offline.', 'success'),
  });
}

void boot();
