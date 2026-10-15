import { notify } from './controller';
import { installAvailable, updateReady } from './state';

/** Chromium-only event, not in lib.dom yet. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;
let installEvent: BeforeInstallPromptEvent | null = null;

/** Registers the service worker (production builds only; dev has none). */
export async function initPwa() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const { registerSW } = await import('virtual:pwa-register');
  updateSW = registerSW({
    onNeedRefresh: () => (updateReady.value = true),
    onOfflineReady: () => notify('Lista para usar sin conexión'),
    onRegisterError: (err: unknown) => console.warn('[pwa] no se pudo registrar', err),
  });
}

/** Activates the waiting version (the page reloads). */
export function applyUpdate() {
  updateReady.value = false;
  void updateSW?.(true);
}

export function dismissUpdate() {
  updateReady.value = false;
}

addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // show our own button instead of the mini-infobar
  installEvent = e as BeforeInstallPromptEvent;
  installAvailable.value = true;
});

addEventListener('appinstalled', () => {
  installEvent = null;
  installAvailable.value = false;
  notify('Camaleón instalada');
});

export async function promptInstall() {
  const e = installEvent;
  if (!e) return;
  installEvent = null;
  installAvailable.value = false;
  await e.prompt();
}
