// Modern date picking: a month calendar popover and a week strip.
// Days that have entries get a dot (spending) or ring (income only).
import { get } from './api.js';
import { t, fmt } from './i18n.js';
import { icon } from './icons.js';

const WEEK_START = 6; // Saturday, same as the server's week reports

// ---------- date helpers (YYYY-MM-DD strings, UTC arithmetic) ----------
const asDate = (s) => new Date(`${s}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
export function addDays(s, n) {
  const d = asDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}
const monthStart = (s) => `${s.slice(0, 7)}-01`;
function addMonths(s, n) {
  const d = asDate(monthStart(s));
  d.setUTCMonth(d.getUTCMonth() + n);
  return iso(d);
}
export const weekStart = (s) => addDays(s, -((asDate(s).getUTCDay() - WEEK_START + 7) % 7));

// ---------- which days have entries ----------
const marks = new Map(); // 'YYYY-MM' -> Promise<Map(date -> bucket)>

function monthMarks(s) {
  const key = s.slice(0, 7);
  if (!marks.has(key)) {
    marks.set(
      key,
      get(`/reports/summary?period=month&date=${key}-01`)
        .then((r) => new Map(r.series.filter((b) => b.count || b.quiet).map((b) => [b.key, b])))
        .catch(() => new Map())
    );
  }
  return marks.get(key);
}

/** Call after entries change so dots refresh. */
export function invalidateMarks() {
  marks.clear();
}

async function marksFor(days) {
  const months = [...new Set(days.map((d) => d.slice(0, 7)))];
  const maps = await Promise.all(months.map((m) => monthMarks(`${m}-01`)));
  return (d) => maps[months.indexOf(d.slice(0, 7))].get(d);
}

const dotFor = (b) =>
  !b ? '' : b.quiet ? '<span class="cal-dot quiet"></span>' : b.expense > 0 ? '<span class="cal-dot"></span>' : '<span class="cal-dot income"></span>';

// ---------- week strip ----------
/** Renders the 7 days around `selected` into `el`. */
export async function renderWeekStrip(el, { selected, today, onSelect }) {
  const start = weekStart(selected);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const draw = (lookup = () => null) => {
    el.innerHTML = days
      .map((d) => {
        const cls = ['wk-day', d === selected && 'selected', d === today && 'today', d > today && 'future'].filter(Boolean).join(' ');
        return `<button type="button" class="${cls}" data-date="${d}" ${d > today ? 'disabled' : ''} aria-pressed="${d === selected}" aria-label="${fmt.longDate(d)}">
          <span class="wk-name">${fmt.date(d, { weekday: 'short' })}</span>
          <span class="wk-num">${fmt.number(Number(d.slice(8)))}</span>
          ${dotFor(lookup(d)) || '<span class="cal-dot empty"></span>'}
        </button>`;
      })
      .join('');
  };
  draw();
  el.onclick = (e) => {
    const b = e.target.closest('[data-date]');
    if (b && !b.disabled) onSelect(b.dataset.date);
  };
  draw(await marksFor(days));
}

// ---------- month popover ----------
let openPopover = null;

export function closeCalendar() {
  openPopover?.close();
}

/**
 * Opens a month calendar next to `anchor`.
 * @param {{anchor: HTMLElement, value: string, max: string, onSelect: (date: string) => void}} opts
 */
export function openCalendar({ anchor, value, max, onSelect }) {
  closeCalendar();
  let month = monthStart(value);
  const host = anchor.closest('dialog') || document.body; // stay above modal dialogs
  const pop = document.createElement('div');
  pop.className = 'cal-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', t('daily.pickDate'));
  const backdrop = document.createElement('div');
  backdrop.className = 'cal-backdrop';
  host.append(backdrop, pop);

  function place() {
    if (window.innerWidth < 560) return pop.classList.add('sheet');
    pop.classList.remove('sheet');
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const left = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), window.innerWidth - w - 12);
    const below = r.bottom + 8 + pop.offsetHeight < window.innerHeight;
    pop.style.left = `${left}px`;
    pop.style.top = `${below ? r.bottom + 8 : Math.max(12, r.top - pop.offsetHeight - 8)}px`;
  }

  async function render() {
    const first = weekStart(month);
    const days = Array.from({ length: 42 }, (_, i) => addDays(first, i));
    const names = Array.from({ length: 7 }, (_, i) => fmt.date(addDays(first, i), { weekday: 'narrow' }));
    const draw = (lookup = () => null) => {
      const nextDisabled = addMonths(month, 1) > max;
      pop.innerHTML = `
        <div class="cal-head">
          <button type="button" class="icon-btn" data-nav="-1" aria-label="${t('rep.prev')}">${icon('chevron-left')}</button>
          <strong>${fmt.monthYear(month)}</strong>
          <button type="button" class="icon-btn" data-nav="1" aria-label="${t('rep.next')}" ${nextDisabled ? 'disabled' : ''}>${icon('chevron-right')}</button>
        </div>
        <div class="cal-grid cal-names">${names.map((n) => `<span>${n}</span>`).join('')}</div>
        <div class="cal-grid">
          ${days
            .map((d) => {
              const cls = ['cal-day', d.slice(0, 7) !== month.slice(0, 7) && 'outside', d === value && 'selected', d === max && 'today'].filter(Boolean).join(' ');
              return `<button type="button" class="${cls}" data-date="${d}" ${d > max ? 'disabled' : ''}>${fmt.number(Number(d.slice(8)))}${dotFor(lookup(d))}</button>`;
            })
            .join('')}
        </div>
        <div class="cal-foot">
          <button type="button" class="btn btn-sm" data-today>${t('daily.today')}</button>
        </div>`;
    };
    draw();
    place();
    const lookup = await marksFor(days);
    if (pop.isConnected && first === weekStart(month)) draw(lookup);
  }

  pop.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      month = addMonths(month, Number(nav.dataset.nav));
      return render();
    }
    const day = e.target.closest('[data-date]');
    const pick = day && !day.disabled ? day.dataset.date : e.target.closest('[data-today]') ? max : null;
    if (pick) {
      close();
      onSelect(pick);
    }
  });

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // don't also close a surrounding <dialog>
      close();
    }
  };
  function close() {
    pop.remove();
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
    openPopover = null;
    anchor.focus();
  }
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', place);
  openPopover = { close };
  render().then(() => pop.querySelector('.cal-day.selected, .cal-day.today')?.focus());
}
