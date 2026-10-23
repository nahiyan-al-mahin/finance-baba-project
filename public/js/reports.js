// Weekly / monthly / yearly analysis with Chart.js, plus PDF download links.
import { get } from './api.js';
import { t, fmt, getLang, categoryLabel, categoryTile, categoryColor } from './i18n.js';
import { $, $$, escapeHtml } from './ui.js';

const rs = { period: 'month', anchor: null, charts: {}, getToday: null };

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function shift(anchor, period, dir) {
  const d = new Date(`${anchor}T00:00:00Z`);
  if (period === 'week') d.setUTCDate(d.getUTCDate() + 7 * dir);
  if (period === 'month') d.setUTCMonth(d.getUTCMonth() + dir, 1);
  if (period === 'year') d.setUTCFullYear(d.getUTCFullYear() + dir, 0, 1);
  return d.toISOString().slice(0, 10);
}

function title(s) {
  if (s.period === 'year') return fmt.year(s.range.start);
  if (s.period === 'month') return fmt.monthYear(s.range.start);
  return `${fmt.date(s.range.start, { day: 'numeric', month: 'short' })} – ${fmt.date(s.range.end)}`;
}

function catRows(list, type) {
  if (!list.length) return `<p class="muted small">${escapeHtml(t('rep.noData'))}</p>`;
  const max = list[0].pct;
  return list
    .map(
      (c) => `
      <div class="cat-row">
        <span class="row">${categoryTile(type, c.category, 'sm')} ${escapeHtml(categoryLabel(type, c.category))}</span>
        <span class="bar"><span style="width:${Math.max(2, (c.pct / max) * 100)}%;--c:${categoryColor(type, c.category)}"></span></span>
        <span class="num">${fmt.money(c.amount)} <span class="muted small">${fmt.pct(c.pct)}</span></span>
      </div>`
    )
    .join('');
}

function insights(s) {
  const out = [];
  const periodWord = t(`period.${s.period}`);
  if (s.expenseChangePct !== null) {
    if (s.expenseChangePct > 0) out.push(t('ins.moreThanPrev', { pct: fmt.pct(s.expenseChangePct), period: periodWord }));
    else if (s.expenseChangePct < 0) out.push(t('ins.lessThanPrev', { pct: fmt.pct(s.expenseChangePct), period: periodWord }));
    else out.push(t('ins.sameAsPrev', { period: periodWord }));
  }
  const top = s.expenseByCategory[0];
  if (top) out.push(t('ins.topCat', { cat: categoryLabel('expense', top.category), pct: fmt.pct(top.pct) }));
  if (s.biggestExpense) {
    out.push(t('ins.biggest', { note: s.biggestExpense.note, amount: fmt.money(s.biggestExpense.amount), date: fmt.date(s.biggestExpense.date) }));
  }
  if (s.busiestBucket && s.period !== 'week') {
    const when = s.period === 'year' ? fmt.date(`${s.busiestBucket.key}-01`, { month: 'long' }) : fmt.date(s.busiestBucket.key);
    out.push(t('ins.busiest', { unit: t(s.period === 'year' ? 'unit.month' : 'unit.day'), when, amount: fmt.money(s.busiestBucket.expense) }));
  }
  if (s.totals.income > 0 && s.totals.net >= 0) out.push(t('ins.saving', { pct: fmt.pct(s.savingsRatePct) }));
  if (s.totals.net < 0 && s.totals.income > 0) out.push(t('ins.overspend', { amount: fmt.money(-s.totals.net) }));
  return out;
}

function drawCharts(s) {
  const text = css('--muted');
  const grid = css('--border');
  Chart.defaults.color = text;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  // Sketchbook: ink outlines instead of soft rounded bars
  const sketch = document.documentElement.dataset.theme === 'sketch';
  const ink = sketch ? { borderColor: css('--text'), borderWidth: 2, borderRadius: 2 } : { borderRadius: 6 };

  const labels = s.series.map((b) =>
    s.period === 'year' ? fmt.monthShort(b.key) : s.period === 'week' ? fmt.date(b.key, { weekday: 'short' }) : fmt.number(Number(b.key.slice(8)))
  );
  rs.charts.trend?.destroy();
  rs.charts.trend = new Chart($('#trend-chart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: t('rep.income'), data: s.series.map((b) => b.income), backgroundColor: css('--income'), ...ink },
        { label: t('rep.expense'), data: s.series.map((b) => b.expense), backgroundColor: css('--expense'), ...ink },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            title: (items) => {
              const key = s.series[items[0].dataIndex].key;
              return s.period === 'year' ? fmt.monthYear(`${key}-01`) : fmt.longDate(key);
            },
            label: (ctx) => `${ctx.dataset.label}: ${fmt.money(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: grid }, ticks: { callback: (v) => fmt.number(v) } },
      },
    },
  });

  rs.charts.cat?.destroy();
  const cats = s.expenseByCategory;
  rs.charts.cat = new Chart($('#cat-chart'), {
    type: 'doughnut',
    data: {
      labels: cats.map((c) => categoryLabel('expense', c.category)),
      datasets: [{ data: cats.map((c) => c.amount), backgroundColor: cats.map((c) => categoryColor('expense', c.category)), borderColor: sketch ? css('--text') : css('--surface'), borderWidth: sketch ? 2 : 3, hoverOffset: 8 }],
    },
    options: {
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: { display: window.innerWidth >= 500, position: 'right', labels: { boxWidth: 12 } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${fmt.money(ctx.parsed)}` } },
      },
    },
  });
  $('#cat-chart').parentElement.hidden = !cats.length;
}

export async function loadReports() {
  const today = rs.getToday();
  rs.anchor ||= today;
  const s = await get(`/reports/summary?period=${rs.period}&date=${rs.anchor}`);
  $$('#period-toggle [data-period]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === rs.period)));
  $('#rep-title').textContent = title(s);
  $('#rep-next').disabled = s.range.end >= today;

  $('#rep-income').textContent = fmt.money(s.totals.income);
  $('#rep-expense').textContent = fmt.money(s.totals.expense);
  $('#rep-net').textContent = fmt.money(s.totals.net);
  $('#rep-avg').textContent = fmt.money(s.avgDailyExpense);

  $('#cat-list').innerHTML = catRows(s.expenseByCategory, 'expense');
  $('#income-list').innerHTML = catRows(s.incomeByCategory, 'income');
  const ins = insights(s);
  $('#insights').innerHTML = ins.length ? ins.map((x) => `<li>${escapeHtml(x)}</li>`).join('') : `<li class="muted">${escapeHtml(t('rep.noData'))}</li>`;

  drawCharts(s);

  // PDFs cover the month / year containing the selected date.
  const lang = getLang();
  $('#pdf-month').href = `/api/reports/pdf?period=month&date=${rs.anchor}&lang=${lang}`;
  $('#pdf-year').href = `/api/reports/pdf?period=year&date=${rs.anchor}&lang=${lang}`;
  $('#pdf-month-label').textContent = `${t('rep.downloadMonth')} · ${fmt.monthYear(rs.anchor)}`;
  $('#pdf-year-label').textContent = `${t('rep.downloadYear')} · ${fmt.year(rs.anchor)}`;
}

export function initReports({ getToday, onError }) {
  rs.getToday = getToday;
  $$('#period-toggle [data-period]').forEach((b) =>
    b.addEventListener('click', () => {
      rs.period = b.dataset.period;
      loadReports().catch(onError);
    })
  );
  $('#rep-prev').addEventListener('click', () => {
    rs.anchor = shift(rs.anchor, rs.period, -1);
    loadReports().catch(onError);
  });
  $('#rep-next').addEventListener('click', () => {
    const next = shift(rs.anchor, rs.period, 1);
    rs.anchor = next > getToday() ? getToday() : next;
    loadReports().catch(onError);
  });
  document.addEventListener('themechange', () => {
    if (!$('#view-reports').hidden) loadReports().catch(onError);
  });
}
