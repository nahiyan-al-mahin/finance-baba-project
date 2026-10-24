// Vercel Web Analytics: cookie-free page-view counts (no personal or finance data).
// Loaded only on the deployed site; Vercel serves /_vercel/insights/script.js there.
(function () {
  var host = location.hostname;
  if (host === 'localhost' || /^(127\.|10\.|192\.168\.|\[)/.test(host)) return;
  window.va =
    window.va ||
    function () {
      (window.vaq = window.vaq || []).push(arguments);
    };
  var s = document.createElement('script');
  s.defer = true;
  s.src = '/_vercel/insights/script.js';
  document.head.appendChild(s);
})();
