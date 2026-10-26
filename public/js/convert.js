// "In Taka" page (live conversion to Bangladeshi Taka) and the currency card in Settings.
import { get, put } from './api.js';
import { t, fmt, getCurrency, setCurrency, currencyName } from './i18n.js';
import { $, toast, dialogAction, escapeHtml } from './ui.js';

let fx = null; // { bdtPer: {code: taka per 1 unit}, updatedAt, source, approximate }
let opts = { getUser: () => null, getToday: () => null, onUser: () => {}, onError: () => {} };

const codes = () => window.FB_CURRENCIES.codes;
const optionsHtml = (selected) =>
  codes()
    .map((c) => `<option value="${c}" ${c === selected ? 'selected' : ''}>${escapeHtml(`${c} — ${currencyName(c)}`)}</option>`)
    .join('');

async function loadRates(force = false) {
  if (!fx || force) fx = await get('/account/fx');
  return fx;
}

const toTaka = (amount, code) => amount * (fx?.bdtPer[code] || 1);

function renderConverter() {
  const amount = Number($('#fx-amount').value) || 0;
  $('#fx-result').textContent = fx ? fmt.money(toTaka(amount, $('#fx-from').value), 'BDT') : '–';
}

function renderRate() {
  const code = getCurrency();
  $('#fx-rate').textContent = code === 'BDT' ? t('fx.rateBdt') : t('fx.rate', { code, bdt: fmt.money(fx.bdtPer[code], 'BDT') });
  $('#fx-rate').classList.toggle('small', code === 'BDT');
  $('#fx-updated').textContent = t('fx.updated', { time: fmt.dateTime(fx.updatedAt), source: fx.source });
  $('#fx-approx').hidden = !fx.approximate;
}

async function renderTotals() {
  const today = opts.getToday();
  const [{ totals: day }, month, year] = await Promise.all([
    get(`/entries?date=${today}`),
    get(`/reports/summary?period=month&date=${today}`),
    get(`/reports/summary?period=year&date=${today}`),
  ]);
  const code = getCurrency();
  const rows = [
    ['fx.today', day.expense, 'expense'],
    ['fx.month', month.totals.expense, 'expense'],
    ['fx.monthIncome', month.totals.income, 'income'],
    ['fx.year', year.totals.expense, 'expense'],
  ];
  $('#fx-totals').innerHTML = rows
    .map(
      ([key, amount, cls]) => `
      <div class="mini-row fx-row">
        <span>${escapeHtml(t(key))}</span>
        <span class="fx-pair">
          ${code === 'BDT' ? '' : `<span class="small muted num">${escapeHtml(fmt.money(amount))} =</span>`}
          <strong class="num ${cls}">${escapeHtml(fmt.money(toTaka(amount, code), 'BDT'))}</strong>
        </span>
      </div>`
    )
    .join('');
}

/** Called when the "In Taka" page opens (and on language change while it is open). */
export async function loadConvert() {
  await loadRates(true);
  const from = $('#fx-from');
  const keep = from.value || (getCurrency() === 'BDT' ? 'USD' : getCurrency());
  from.innerHTML = optionsHtml(keep);
  renderRate();
  renderConverter();
  await renderTotals();
}

// ---- Settings card
export function renderCurrencyCard() {
  const user = opts.getUser();
  if (!user) return;
  $('#cur-select').innerHTML = optionsHtml(user.currency);
  const history = user.currencyHistory || [];
  $('#cur-history').innerHTML = history.length
    ? history
        .slice()
        .reverse()
        .map((h) => `<li>${escapeHtml(t('cur.historyItem', { date: fmt.date(h.date), from: h.from, to: h.to }))}</li>`)
        .join('')
    : `<li>${escapeHtml(t('cur.historyNone', { code: user.currency }))}</li>`;
}

async function changeCurrency() {
  const user = opts.getUser();
  const to = $('#cur-select').value;
  if (to === user.currency) return toast(t('cur.same'));
  const res = await dialogAction($('#currency-dialog'), () => put('/account/currency', { currency: to }), {
    onOpen: () => {
      $('#currency-confirm-text').textContent = t('cur.confirmBody', { date: fmt.date(opts.getToday()), from: user.currency, to });
    },
  });
  if (!res) return renderCurrencyCard();
  setCurrency(res.user.currency);
  opts.onUser(res.user);
  renderCurrencyCard();
  toast(t('cur.changed', { code: res.user.currency }));
}

export function initConvert(options) {
  opts = { ...opts, ...options };
  $('#fx-amount').addEventListener('input', renderConverter);
  $('#fx-from').addEventListener('change', renderConverter);
  $('#cur-save').addEventListener('click', () => changeCurrency().catch(opts.onError));
}
