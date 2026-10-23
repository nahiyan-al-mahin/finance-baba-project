// "What is what" welcome slides, shown after the first sign-up and from Settings.
import { t, onLangChange } from './i18n.js';
import { icon } from './icons.js';

const SLIDES = [
  { art: 'wallet', key: 's1' },
  { art: 'pencil', key: 's2' },
  { art: 'calculator', key: 's3' },
  { art: 'chart', key: 's4' },
  { art: 'lock', key: 's5' },
  { art: 'file', key: 's6' },
  { art: 'shield', key: 's7' },
];

export function startOnboarding(onFinish) {
  document.querySelector('.onboarding')?.remove();
  let index = 0;

  const root = document.createElement('div');
  root.className = 'onboarding';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.innerHTML = `
    <div class="onb-card">
      <div style="overflow:hidden"><div class="onb-track"></div></div>
      <div class="onb-footer">
        <button class="btn btn-ghost" data-onb="skip"></button>
        <div class="dots"></div>
        <div class="row">
          <button class="btn" data-onb="back"></button>
          <button class="btn btn-primary" data-onb="next"></button>
        </div>
      </div>
    </div>`;
  document.body.append(root);
  const track = root.querySelector('.onb-track');
  const dots = root.querySelector('.dots');

  function render() {
    track.innerHTML = SLIDES.map(
      (s) => `
      <div class="onb-slide">
        <div class="onb-art">${icon(s.art)}</div>
        <h2>${t(`onb.${s.key}.title`)}</h2>
        <p>${t(`onb.${s.key}.body`)}</p>
      </div>`
    ).join('');
    dots.innerHTML = SLIDES.map((_, i) => `<span class="${i === index ? 'active' : ''}"></span>`).join('');
    track.style.transform = `translateX(-${index * 100}%)`;
    root.setAttribute('aria-label', t(`onb.${SLIDES[index].key}.title`));
    const last = index === SLIDES.length - 1;
    root.querySelector('[data-onb=skip]').textContent = t('onb.skip');
    root.querySelector('[data-onb=skip]').style.visibility = last ? 'hidden' : 'visible';
    root.querySelector('[data-onb=back]').textContent = t('onb.back');
    root.querySelector('[data-onb=back]').hidden = index === 0;
    root.querySelector('[data-onb=next]').textContent = last ? t('onb.done') : t('onb.next');
  }

  function go(i) {
    index = Math.max(0, Math.min(SLIDES.length - 1, i));
    render();
  }

  function finish() {
    root.remove();
    document.removeEventListener('keydown', onKey);
    onFinish?.();
  }

  function onKey(e) {
    if (e.key === 'ArrowRight') go(index + 1);
    if (e.key === 'ArrowLeft') go(index - 1);
    if (e.key === 'Escape') finish();
  }

  root.addEventListener('click', (e) => {
    const action = e.target.closest('[data-onb]')?.dataset.onb;
    if (action === 'skip') finish();
    if (action === 'back') go(index - 1);
    if (action === 'next') (index === SLIDES.length - 1 ? finish() : go(index + 1));
  });
  document.addEventListener('keydown', onKey);

  // Swipe on phones
  let startX = null;
  track.addEventListener('touchstart', (e) => (startX = e.touches[0].clientX), { passive: true });
  track.addEventListener('touchend', (e) => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1));
    startX = null;
  });

  onLangChange(() => document.body.contains(root) && render());
  render();
  root.querySelector('[data-onb=next]').focus();
}
