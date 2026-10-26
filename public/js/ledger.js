// Loans & Savings page, plus the "open loans" card on the Daily page.
import { get, post, del } from './api.js';
import { t, fmt, getCurrency, currencySymbol } from './i18n.js';
import { $, $$, toast, busy, showFormError, dialogAction, escapeHtml } from './ui.js';
import { icon } from './icons.js';
import { openCalendar } from './calendar.js';

let opts = { getToday: () => null, withUnlock: (fn) => fn(), onError: () => {} };
let loansData = null;
let savingsData = null;
let tab = 'loans';

const FAR_FUTURE = '2100-12-31';
const dateLabel = (d) => fmt.date(d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const original = (amount, code) => (code !== getCurrency() ? ` <span class="small muted">(${escapeHtml(fmt.money(amount, code))})</span>` : '');

/** A button that opens the calendar and keeps the chosen date in a hidden input. */
function dateField(button, input, { max, optional } = {}) {
  const label = $('span', button);
  const set = (d) => {
    input.value = d || '';
    label.textContent = d ? dateLabel(d) : t('loan.noDue');
    const clear = button.parentElement.querySelector('[data-clear]');
    if (clear) clear.hidden = !d;
  };
  button.addEventListener('click', () =>
    openCalendar({ anchor: button, value: input.value || opts.getToday(), max: max ? max() : FAR_FUTURE, onSelect: set })
  );
  if (optional) button.parentElement.querySelector('[data-clear]')?.addEventListener('click', () => set(''));
  return set;
}

// ------------------------------------------------------------------ loans

function loanItem(l, compact = false) {
  const lent = l.direction === 'lent';
  const pct = l.amount ? Math.min(100, (l.paid / l.amount) * 100) : 0;
  const meta = [
    t(lent ? 'loan.lentOn' : 'loan.borrowedOn', { date: fmt.date(l.date) }),
    l.dueDate && l.open ? t(l.overdue ? 'loan.overdueSince' : 'loan.dueOn', { date: fmt.date(l.dueDate) }) : null,
    !l.open ? t(lent ? 'loan.receivedOn' : 'loan.paidOn', { date: fmt.date(l.settledAt) }) : null,
  ].filter(Boolean);
  const head = `
    <div class="loan-head">
      <span class="loan-dir ${lent ? 'lent' : 'borrowed'}">${icon(lent ? 'arrow-out' : 'arrow-in')}</span>
      <div class="loan-who">
        <strong>${escapeHtml(l.person)}</strong>
        <span class="small muted">${escapeHtml(t(lent ? 'loan.owesYou' : 'loan.youOwe'))}</span>
      </div>
      <div class="loan-left">
        <strong class="num ${lent ? 'income' : 'expense'}">${escapeHtml(fmt.money(l.open ? l.display.remaining : l.display.amount))}</strong>
        ${l.open && l.currency !== getCurrency() ? `<span class="small muted num">${escapeHtml(fmt.money(l.remaining, l.currency))}</span>` : ''}
      </div>
    </div>`;
  if (compact) {
    return `<li class="loan-item compact ${l.overdue ? 'overdue' : ''}">${head}
      <div class="small muted">${meta.map(escapeHtml).join(' · ')}${l.overdue ? ` <span class="badge flag">${escapeHtml(t('loan.overdue'))}</span>` : ''}</div></li>`;
  }
  const payments = l.payments
    .map(
      (p) => `<li>
        <span>${escapeHtml(fmt.date(p.date))}${p.note ? ` · ${escapeHtml(p.note)}` : ''}</span>
        <span class="row"><strong class="num">${escapeHtml(fmt.money(p.amount, l.currency))}</strong>
        <button class="icon-btn icon-btn-sm" type="button" data-undo="${escapeHtml(p.id)}" title="${escapeHtml(t('loan.undo'))}" aria-label="${escapeHtml(t('loan.undo'))}">${icon('trash')}</button></span>
      </li>`
    )
    .join('');
  return `
    <li class="loan-item ${l.open ? '' : 'settled'} ${l.overdue ? 'overdue' : ''}" data-id="${l.id}">
      ${head}
      <div class="meter" aria-hidden="true"><span class="${lent ? '' : 'warn'}" style="width:${Math.max(2, pct)}%"></span></div>
      <div class="small muted">
        ${escapeHtml(t(lent ? 'loan.gotBack' : 'loan.paidBack', { paid: fmt.money(l.paid, l.currency), total: fmt.money(l.amount, l.currency) }))}
        ${l.overdue ? `<span class="badge flag">${escapeHtml(t('loan.overdue'))}</span>` : ''}
        ${!l.open ? `<span class="badge unlocked">${icon('check-circle')} ${escapeHtml(t('loan.settled'))}</span>` : ''}
      </div>
      <div class="small muted">${meta.map(escapeHtml).join(' · ')}</div>
      ${l.note ? `<p class="loan-note">${escapeHtml(l.note)}</p>` : ''}
      ${payments ? `<details class="loan-payments"><summary class="small">${escapeHtml(t('loan.history', { n: fmt.number(l.payments.length) }))}</summary><ul>${payments}</ul></details>` : ''}
      <div class="loan-actions">
        ${l.open ? `<button class="btn btn-sm btn-primary" type="button" data-pay>${icon('plus')} ${escapeHtml(t(lent ? 'loan.recordReceived' : 'loan.recordPaid'))}</button>` : ''}
        <button class="icon-btn" type="button" data-delete title="${escapeHtml(t('daily.delete'))}" aria-label="${escapeHtml(t('daily.delete'))}">${icon('trash')}</button>
      </div>
    </li>`;
}

function renderLoans() {
  const d = loansData;
  if (!d) return;
  $('#ln-owe').textContent = fmt.money(d.totals.owe);
  $('#ln-owed').textContent = fmt.money(d.totals.owed);
  const open = d.loans.filter((l) => l.open);
  const settled = d.loans.filter((l) => !l.open);
  $('#loan-list').innerHTML = open.length
    ? open.map((l) => loanItem(l)).join('')
    : `<li class="empty"><span class="empty-art">${icon('handshake')}</span>${escapeHtml(t('loan.none'))}</li>`;
  $('#loan-settled').hidden = !settled.length;
  $('#loan-settled-count').textContent = fmt.number(settled.length);
  $('#loan-settled-list').innerHTML = settled.map((l) => loanItem(l)).join('');
  renderDailyLoans();
}

/** Open loans stay on the Daily page until they are settled. */
function renderDailyLoans() {
  const open = (loansData?.loans || []).filter((l) => l.open);
  $('#daily-loans').hidden = !open.length;
  if (!open.length) return;
  $('#daily-loans-sum').textContent = [
    loansData.totals.owe ? t('loan.sumOwe', { amount: fmt.money(loansData.totals.owe) }) : null,
    loansData.totals.owed ? t('loan.sumOwed', { amount: fmt.money(loansData.totals.owed) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  $('#daily-loan-list').innerHTML = open
    .slice(0, 4)
    .map((l) => loanItem(l, true))
    .join('');
  $('#daily-loans-more').textContent = open.length > 4 ? t('loan.more', { n: fmt.number(open.length - 4) }) : t('loan.manage');
}

export async function loadLoans() {
  loansData = await get('/loans');
  renderLoans();
}

async function recordPayment(loan) {
  const dialog = $('#payment-dialog');
  const lent = loan.direction === 'lent';
  const res = await dialogAction(
    dialog,
    (data) =>
      opts.withUnlock(() =>
        post(`/loans/${loan.id}/payments`, { amount: data.get('amount'), date: data.get('date'), note: data.get('note') })
      ),
    {
      onOpen(form) {
        $('#payment-title').textContent = t(lent ? 'loan.recordReceived' : 'loan.recordPaid');
        $('#payment-info').textContent = t(lent ? 'loan.payInfoLent' : 'loan.payInfoBorrowed', {
          person: loan.person,
          amount: fmt.money(loan.remaining, loan.currency),
        });
        $('label[for=pay-amount]', dialog).textContent = t('daily.amount', { cur: currencySymbol(loan.currency) });
        form.elements.amount.value = loan.remaining;
        form.elements.amount.max = loan.remaining;
        setPayDate(opts.getToday());
      },
    }
  ).catch(opts.onError);
  if (!res) return;
  toast(t(res.loan.open ? 'loan.paymentSaved' : lent ? 'loan.closedLent' : 'loan.closedBorrowed'));
  await loadLoans();
}

let setPayDate = () => {};

async function onLoanListClick(e) {
  const item = e.target.closest('[data-id]');
  if (!item) return;
  const loan = loansData.loans.find((l) => String(l.id) === item.dataset.id);
  if (!loan) return;
  if (e.target.closest('[data-pay]')) return recordPayment(loan);
  const undo = e.target.closest('[data-undo]');
  if (undo) {
    await opts.withUnlock(() => del(`/loans/${loan.id}/payments/${undo.dataset.undo}`));
    toast(t('loan.undone'));
    return loadLoans();
  }
  if (e.target.closest('[data-delete]')) {
    const done = await dialogAction($('#confirm-dialog'), () => opts.withUnlock(() => del(`/loans/${loan.id}`)), {
      onOpen: () => ($('#confirm-text').textContent = t('loan.confirmDelete', { person: loan.person })),
    });
    if (!done) return;
    toast(t('daily.deleted'));
    return loadLoans();
  }
}

function initLoanForm() {
  const form = $('#loan-form');
  const setDir = (dir) => {
    $$('[data-dir]', form).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dir === dir)));
    form.elements.direction.value = dir;
    $('label[for=ln-person]', form).textContent = t(dir === 'lent' ? 'loan.toWhom' : 'loan.fromWhom');
  };
  $$('[data-dir]', form).forEach((b) => b.addEventListener('click', () => setDir(b.dataset.dir)));
  const setDate = dateField($('#ln-date'), form.elements.date, { max: opts.getToday });
  const setDue = dateField($('#ln-due'), form.elements.dueDate, { optional: true });
  const reset = () => {
    setDate(opts.getToday());
    setDue('');
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    busy(form, async () => {
      try {
        showFormError(form, null);
        const res = await opts.withUnlock(() => post('/loans', data));
        if (!res) return;
        form.elements.person.value = '';
        form.elements.amount.value = '';
        form.elements.note.value = '';
        reset();
        toast(t('loan.added'));
        await loadLoans();
      } catch (err) {
        if (err.status === 401) return opts.onError(err);
        showFormError(form, err);
      }
    });
  });
  setDir('borrowed');
  return { reset, setDir };
}

// ------------------------------------------------------------------ savings

function renderSavings() {
  const s = savingsData;
  if (!s) return;
  $('#sv-balance').textContent = fmt.money(s.balance);
  $('#sv-added').textContent = fmt.money(s.month.added);
  $('#sv-withdrawn').textContent = fmt.money(s.month.withdrawn);

  const max = Math.max(1, ...s.months.map((m) => Math.abs(m.net)));
  $('#sv-months').innerHTML = s.months
    .map((m) => {
      const h = m.net ? Math.max(6, (Math.abs(m.net) / max) * 100) : 0;
      return `<div class="sv-bar ${m.net < 0 ? 'neg' : ''}" title="${escapeHtml(fmt.monthYear(`${m.month}-01`))}: ${escapeHtml(fmt.money(m.net))}">
        <div class="sv-bar-track"><span style="height:${h}%"></span></div>
        <small>${escapeHtml(fmt.monthShort(m.month))}</small>
      </div>`;
    })
    .join('');

  // A plain-language answer to "am I able to save?"
  let insight;
  if (!s.logs.length) insight = t('sav.insightNone');
  else if (s.month.net > 0) insight = t('sav.insightGood', { amount: fmt.money(s.month.net) });
  else if (s.month.net < 0) insight = t('sav.insightBad', { amount: fmt.money(-s.month.net) });
  else insight = t('sav.insightFlat');
  if (s.trackedMonths > 1) insight += ` ${t('sav.insightMonths', { saved: fmt.number(s.savedMonths), total: fmt.number(s.trackedMonths) })}`;
  $('#sv-insight').textContent = insight;

  $('#sv-list').innerHTML = s.logs.length
    ? s.logs
        .map(
          (l) => `
      <li class="entry" data-id="${l.id}">
        <span class="cat-tile entry-icon" style="--c:${l.type === 'deposit' ? '#2f9e44' : '#e8590c'}" aria-hidden="true">${icon(l.type === 'deposit' ? 'arrow-in' : 'arrow-out')}</span>
        <div class="entry-body">
          <div class="entry-note">${escapeHtml(l.note || t(l.type === 'deposit' ? 'sav.deposit' : 'sav.withdraw'))}</div>
          <div class="entry-meta">${escapeHtml(t(l.type === 'deposit' ? 'sav.deposit' : 'sav.withdraw'))} · ${escapeHtml(fmt.date(l.date))}${
            l.converted ? ` · <span class="entry-orig">${escapeHtml(t('cur.original', { amount: fmt.money(l.originalAmount, l.currency) }))}</span>` : ''
          }</div>
        </div>
        <span class="entry-amount ${l.type === 'deposit' ? 'income' : 'expense'}">${l.type === 'deposit' ? '+' : '−'}${escapeHtml(fmt.money(l.amount))}</span>
        <span class="entry-actions"><button class="icon-btn" data-delete title="${escapeHtml(t('daily.delete'))}" aria-label="${escapeHtml(t('daily.delete'))}">${icon('trash')}</button></span>
      </li>`
        )
        .join('')
    : `<li class="empty"><span class="empty-art">${icon('piggy')}</span>${escapeHtml(t('sav.empty'))}</li>`;
}

export async function loadSavings() {
  savingsData = await get('/savings');
  renderSavings();
}

function initSavingForm() {
  const form = $('#saving-form');
  const setType = (type) => {
    $$('[data-stype]', form).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.stype === type)));
    form.elements.type.value = type;
    $('#sv-submit-label').textContent = t(type === 'deposit' ? 'sav.addBtn' : 'sav.withdrawBtn');
  };
  $$('[data-stype]', form).forEach((b) => b.addEventListener('click', () => setType(b.dataset.stype)));
  const setDate = dateField($('#sv-date'), form.elements.date, { max: opts.getToday });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    busy(form, async () => {
      try {
        showFormError(form, null);
        const res = await opts.withUnlock(() => post('/savings', data));
        if (!res) return;
        savingsData = res.summary;
        renderSavings();
        form.elements.amount.value = '';
        form.elements.note.value = '';
        setDate(opts.getToday());
        toast(t(data.type === 'deposit' ? 'sav.added' : 'sav.withdrawn'));
      } catch (err) {
        if (err.status === 401) return opts.onError(err);
        if (err.code === 'NOT_ENOUGH_SAVINGS') return showFormError(form, t('err.NOT_ENOUGH_SAVINGS', { balance: fmt.money(err.data.balance) }));
        showFormError(form, err);
      }
    });
  });
  $('#sv-list').addEventListener('click', async (e) => {
    if (!e.target.closest('[data-delete]')) return;
    const log = savingsData.logs.find((l) => String(l.id) === e.target.closest('[data-id]').dataset.id);
    const done = await dialogAction($('#confirm-dialog'), () => opts.withUnlock(() => del(`/savings/${log.id}`)), {
      onOpen: () => ($('#confirm-text').textContent = `${t('sav.confirmDelete')} (${fmt.money(log.amount)})`),
    }).catch(opts.onError);
    if (!done) return;
    savingsData = done.summary;
    renderSavings();
    toast(t('daily.deleted'));
  });
  setType('deposit');
  return { reset: () => setDate(opts.getToday()), setType };
}

// ------------------------------------------------------------------ page

let forms = null;

function showTab(next) {
  tab = next === 'savings' ? 'savings' : 'loans';
  $$('#ledger-tabs [data-ltab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ltab === tab)));
  $('#ledger-loans').hidden = tab !== 'loans';
  $('#ledger-savings').hidden = tab !== 'savings';
}

/** Called when the page opens, and on language / currency changes. */
export async function loadLedger() {
  forms.loans.setDir($('#loan-form').elements.direction.value);
  forms.savings.setType($('#saving-form').elements.type.value);
  forms.loans.reset();
  forms.savings.reset();
  await Promise.all([loadLoans(), loadSavings()]);
}

export function refreshLedgerText() {
  renderLoans();
  renderSavings();
}

export function initLedger(options) {
  opts = { ...opts, ...options };
  forms = { loans: initLoanForm(), savings: initSavingForm() };
  $$('#ledger-tabs [data-ltab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.ltab)));
  $('#ledger-loans').addEventListener('click', (e) => onLoanListClick(e).catch(opts.onError));
  setPayDate = dateField($('#pay-date'), $('#payment-dialog form').elements.date, { max: opts.getToday });
  $('#daily-loans-more').addEventListener('click', () => (location.hash = 'ledger'));
  showTab('loans');
}
