// Side panels for wide screens: month overview, week mini-chart, top categories, streak and a tip.
// Only fetched while the panels are actually visible.
import { get } from './api.js';
import { t, fmt, getLang, categoryLabel, categoryTile } from './i18n.js';
import { $, escapeHtml } from './ui.js';
import { addDays, weekStart } from './calendar.js';

const wide = window.matchMedia('(min-width: 1280px)');
let ctx = null;

const TIP_COUNT = 10;

function initials(name) {
  return (
    String(name || '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => [...w][0])
      .join('')
      .toUpperCase() || '?'
  );
}

/** Consecutive days (ending today, or yesterday if today is still empty) that have at least one entry. */
async function streak(today, month) {
  const logged = new Set(month.series.filter((b) => b.count).map((b) => b.key));
  let day = logged.has(today) ? today : addDays(today, -1);
  let n = 0;
  let loadedMonth = today.slice(0, 7);
  for (let guard = 0; guard < 400; guard++) {
    if (day.slice(0, 7) !== loadedMonth) {
      const older = await get(`/reports/summary?period=month&date=${day}`);
      older.series.filter((b) => b.count).forEach((b) => logged.add(b.key));
      loadedMonth = day.slice(0, 7);
    }
    if (!logged.has(day)) break;
    n++;
    day = addDays(day, -1);
  }
  return n;
}

function renderProfile() {
  const user = ctx.getUser();
  $('#sb-avatar').textContent = initials(user.displayName);
  $('#sb-name').textContent = user.displayName;
  $('#sb-id').textContent = user.id;
}

function renderMonth(m) {
  const { income, expense, net } = m.totals;
  $('#sb-month').textContent = fmt.monthYear(m.range.start);
  $('#sb-income').textContent = fmt.money(income);
  $('#sb-expense').textContent = fmt.money(expense);
  $('#sb-net').textContent = fmt.money(net);
  $('#sb-net').className = `num ${net < 0 ? 'expense' : 'income'}`;
  const pct = income > 0 ? (expense / income) * 100 : null;
  const meter = $('#sb-meter');
  meter.style.width = `${pct === null ? (expense > 0 ? 100 : 0) : Math.min(100, pct)}%`;
  meter.className = pct === null || pct > 90 ? 'danger' : pct > 70 ? 'warn' : '';
  $('#sb-meter-text').textContent = pct === null ? t(expense > 0 ? 'side.noIncome' : 'rep.noData') : t('side.spentOfIncome', { pct: fmt.pct(pct) });
  $('#sb-pdf').href = `/api/reports/pdf?period=month&date=${m.range.start}&lang=${getLang()}`;

  const top = m.expenseByCategory.slice(0, 3);
  $('#sb-top').innerHTML = top.length
    ? top
        .map(
          (c) => `
        <div class="mini-cat">
          ${categoryTile('expense', c.category, 'sm')}
          <span class="mini-cat-name">${escapeHtml(categoryLabel('expense', c.category))}<span class="muted small">${fmt.pct(c.pct)}</span></span>
          <strong class="num">${fmt.money(c.amount)}</strong>
        </div>`
        )
        .join('')
    : `<p class="muted small">${escapeHtml(t('rep.noData'))}</p>`;
}

function renderWeek(w, today) {
  const max = Math.max(1, ...w.series.map((b) => b.expense));
  $('#sb-week').innerHTML = w.series
    .map((b) => {
      const h = b.expense ? Math.max(6, (b.expense / max) * 100) : 0;
      const cls = ['mini-bar', b.key === today && 'today', b.key > today && 'future'].filter(Boolean).join(' ');
      return `<div class="${cls}" title="${fmt.date(b.key)} · ${fmt.money(b.expense)}">
        <div class="mini-bar-track"><span style="height:${h}%"></span></div>
        <small>${fmt.date(b.key, { weekday: 'narrow' })}</small>
      </div>`;
    })
    .join('');
  $('#sb-week-total').textContent = fmt.money(w.totals.expense);
}

function renderStreak(n) {
  $('#sb-streak-num').textContent = fmt.number(n);
  $('#sb-streak-title').textContent = n ? t('side.streak', { n: fmt.number(n) }) : t('side.streakZero');
  $('#sb-streak-sub').textContent = t('side.streakSub');
}

function renderTip(today) {
  const day = Math.floor(Date.parse(`${today}T00:00:00Z`) / 86400000);
  $('#sb-tip').textContent = t(`tip.${(day % TIP_COUNT) + 1}`);
}

/** Re-fetches and redraws the panels (no-op on narrow screens). */
export async function refreshSidebar() {
  if (!ctx || !wide.matches) return;
  const today = ctx.getToday();
  renderProfile();
  renderTip(today);
  try {
    const [month, week] = await Promise.all([
      get(`/reports/summary?period=month&date=${today}`),
      get(`/reports/summary?period=week&date=${weekStart(today)}`),
    ]);
    renderMonth(month);
    renderWeek(week, today);
    renderStreak(await streak(today, month));
  } catch (err) {
    ctx.onError(err);
  }
}

export function initSidebar({ getUser, getToday, onError }) {
  ctx = { getUser, getToday, onError };
  wide.addEventListener('change', refreshSidebar);
  refreshSidebar();
}
