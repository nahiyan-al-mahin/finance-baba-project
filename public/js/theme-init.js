// Loaded synchronously in <head> so the page never flashes the wrong theme/language.
(function () {
  var theme = 'light';
  var lang = 'en';
  try {
    theme = localStorage.getItem('fb-theme') || 'light';
    lang = localStorage.getItem('fb-lang') || 'en';
  } catch (e) {}
  document.documentElement.setAttribute('data-theme', theme === 'dark' || theme === 'sketch' ? theme : 'light');
  document.documentElement.setAttribute('lang', lang === 'bn' ? 'bn' : 'en');
})();
