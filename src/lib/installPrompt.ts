// Shows a small "Install App" button when the browser offers PWA install
// (beforeinstallprompt). Hides permanently once installed, and for the
// rest of the session if dismissed. No-op when already running standalone.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export function setupInstallButton() {
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  if (isStandalone) return;

  let deferred: BeforeInstallPromptEvent | null = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    if (sessionStorage.getItem('nft-tool-install-dismissed') === '1') return;

    const wrap = document.createElement('div');
    wrap.id = 'pwa-install-wrap';
    wrap.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;align-items:center;gap:4px;';

    const btn = document.createElement('button');
    btn.textContent = 'Install App';
    btn.style.cssText =
      'background:#2563eb;color:#fff;border:1px solid rgba(255,255,255,.15);padding:10px 16px;border-radius:8px;font:600 13px/1 Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.5);';
    btn.addEventListener('click', async () => {
      if (!deferred) return;
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === 'accepted') wrap.remove();
      deferred = null;
    });

    const close = document.createElement('button');
    close.textContent = '×';
    close.setAttribute('aria-label', 'Dismiss install prompt');
    close.style.cssText =
      'background:#1a1a1a;color:#9ca3af;border:1px solid rgba(255,255,255,.12);width:28px;height:28px;border-radius:8px;font:16px/1 system-ui,sans-serif;cursor:pointer;';
    close.addEventListener('click', () => {
      sessionStorage.setItem('nft-tool-install-dismissed', '1');
      wrap.remove();
    });

    wrap.append(btn, close);
    document.body.appendChild(wrap);
  });

  window.addEventListener('appinstalled', () => {
    document.getElementById('pwa-install-wrap')?.remove();
    deferred = null;
  });
}
