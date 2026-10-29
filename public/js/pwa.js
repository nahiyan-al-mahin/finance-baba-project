// Registers the service worker (installable app + offline page) and powers the "Install the app" button.
(function () {
  if ('serviceWorker' in navigator && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  let deferred = null;
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true || document.referrer.startsWith('android-app://');
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

  function update() {
    document.querySelectorAll('[data-install]').forEach((box) => {
      const btn = box.querySelector('[data-install-btn]');
      const hint = box.querySelector('[data-install-ios]');
      const installed = standalone();
      box.hidden = installed || (!deferred && !ios);
      if (btn) btn.hidden = !deferred;
      if (hint) hint.hidden = !ios || !!deferred;
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    update();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    update();
  });
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-install-btn]') || !deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null;
    update();
  });
  document.addEventListener('DOMContentLoaded', update);
})();
