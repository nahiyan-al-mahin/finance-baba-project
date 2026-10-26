import { get, post, put, patch, del } from './api.js';
import { t, fmt, setLang, getLang, onLangChange, applyI18n, categoryLabel, categoryTile, setCurrency, currencySymbol } from './i18n.js';
import { $, $$, initChrome, toast, errorMessage, showFormError, busy, openDialog, dialogAction, escapeHtml, setTheme, getTheme } from './ui.js';
import { initReports, loadReports } from './reports.js';
import { startOnboarding } from './onboarding.js';
import { googleAvailable, renderGoogleButton } from './google.js';
import { icon } from './icons.js';
import { addDays, openCalendar, renderWeekStrip, invalidateMarks } from './calendar.js';
import { initSidebar, refreshSidebar } from './sidebar.js';
import { initTarget, loadTarget, handleTargetUpdate, renderTarget } from './target.js';
import { renderEmailWidget } from './email.js';
import { initConvert, loadConvert, renderCurrencyCard } from './convert.js';

const state = { user: null, today: null, date: null, unlockedUntil: 0, view: 'daily', entries: [] };
// Shared with the email widgets (Settings card and the confirm-email gate).
const emailState = { user: null, pendingEmail: null, emailEnabled: false };
const widgets = [];

function setUser(user) {
  const changed = state.user && state.user.currency !== user.currency;
  state.user = user;
  emailState.user = user;
  setCurrency(user.currency);
  // Totals everywhere are shown in the chosen currency: redraw them after a change.
  if (changed) {
    loadDay().catch(handleError);
    loadTarget().catch(handleError);
    refreshSidebar();
  }
}

// ---------- helpers ----------
function handleError(err) {
  if (err?.status === 401 && err.code === 'UNAUTHENTICATED') {
    location.replace('/');
    return;
  }
  toast(errorMessage(err), 'error');
}

/** Renders the category chips (radio buttons named "category") into `picker`. */
function fillCategories(picker, type, selected) {
  const name = picker.closest('form') ? 'category' : '';
  const cats = window.FB_CATEGORIES[type];
  const current = selected || cats[0].id;
  picker.innerHTML = cats
    .map(
      (c) => `
      <label class="cat-chip">
        <input type="radio" name="${name}" value="${c.id}" ${c.id === current ? 'checked' : ''} />
        ${categoryTile(type, c.id)}
        <span>${escapeHtml(c[getLang()])}</span>
      </label>`
    )
    .join('');
}

function setTypeToggle(root, type) {
  $$('.type-toggle [data-type]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === type)));
  $('input[name=type]', root).value = type;
}

/** Runs `fn`; if the server says the day is locked, asks for the password and retries once. */
async function withUnlock(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.code !== 'PAST_DAY_LOCKED') throw err;
    const unlocked = await dialogAction($('#unlock-dialog'), async (data) => post('/auth/unlock', { password: data.get('password') }));
    if (!unlocked) return null;
    state.unlockedUntil = unlocked.unlockedUntil;
    renderDayHeader();
    setTimeout(renderDayHeader, unlocked.unlockedUntil - Date.now() + 500);
    return fn();
  }
}

// ---------- navigation ----------
function showView(view) {
  if (!['daily', 'reports', 'convert', 'settings'].includes(view)) view = 'daily';
  state.view = view;
  $$('main > section').forEach((s) => (s.hidden = s.id !== `view-${view}`));
  $$('[data-view]').forEach((b) => (b.getAttribute('data-view') === view ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  document.body.dataset.titleKey = `nav.${view}`;
  applyI18n();
  if (view === 'reports') loadReports().catch(handleError);
  if (view === 'settings') renderSettings();
  if (view === 'convert') loadConvert().catch(handleError);
  if (view === 'daily' && state.user) loadWarnings().catch(() => {});
  window.scrollTo(0, 0);
}

$$('[data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    location.hash = b.dataset.view;
  })
);
window.addEventListener('hashchange', () => showView(location.hash.slice(1)));

// ---------- daily ----------
function renderDayHeader() {
  const isToday = state.date === state.today;
  $('#day-title').textContent = isToday ? t('daily.today') : fmt.date(state.date, { weekday: 'long' });
  $('#day-sub').textContent = fmt.date(state.date, { day: 'numeric', month: 'long', year: 'numeric' });
  const badge = $('#day-badge');
  const unlocked = state.unlockedUntil > Date.now();
  badge.hidden = isToday;
  badge.className = `badge ${unlocked ? 'unlocked' : 'locked'}`;
  badge.innerHTML = unlocked ? `${icon('unlock')} ${escapeHtml(t('daily.unlocked'))}` : `${icon('lock')} ${escapeHtml(t('daily.pastLocked'))}`;
  $('#day-today').hidden = isToday;
  $('#week-next').disabled = isToday;
  $('#day-total-label').textContent = t(isToday ? 'daily.totalSpentToday' : 'daily.totalSpent');
  renderWeekStrip($('#week-days'), { selected: state.date, today: state.today, onSelect: (d) => loadDay(d).catch(handleError) });
}

function renderEntries(totals) {
  $('#day-expense').textContent = fmt.money(totals.expense);
  $('#day-income').textContent = fmt.money(totals.income);
  $('#day-net').textContent = fmt.money(totals.net);
  $('#day-total').textContent = fmt.money(totals.expense);
  const list = $('#entry-list');
  if (!state.entries.length) {
    list.innerHTML = `<li class="empty"><span class="empty-art">${icon('inbox')}</span>${escapeHtml(t('daily.empty'))}</li>`;
    return;
  }
  list.innerHTML = state.entries
    .map(
      (e) => `
      <li class="entry" data-id="${e.id}">
        ${categoryTile(e.type, e.category, 'entry-icon')}
        <div class="entry-body">
          <div class="entry-note">${escapeHtml(e.note)}</div>
          <div class="entry-meta">${escapeHtml(categoryLabel(e.type, e.category))} · ${fmt.time(e.createdAt)}${
            e.converted ? ` · <span class="entry-orig">${escapeHtml(t('cur.original', { amount: fmt.money(e.originalAmount, e.currency) }))}</span>` : ''
          }</div>
        </div>
        <span class="entry-amount ${e.type}">${e.type === 'income' ? '+' : '−'}${fmt.money(e.amount)}</span>
        <span class="entry-actions">
          <button class="icon-btn" data-action="edit" title="${escapeHtml(t('daily.edit'))}" aria-label="${escapeHtml(t('daily.edit'))}">${icon('pencil')}</button>
          <button class="icon-btn" data-action="delete" title="${escapeHtml(t('daily.delete'))}" aria-label="${escapeHtml(t('daily.delete'))}">${icon('trash')}</button>
        </span>
      </li>`
    )
    .join('');
}

let lastTotals = { income: 0, expense: 0, net: 0 };
async function loadDay(date = state.date) {
  const data = await get(`/entries?date=${date}`);
  state.date = data.date;
  state.today = data.today;
  state.entries = data.entries;
  lastTotals = data.totals;
  renderDayHeader();
  renderEntries(data.totals);
}

function updateAddFormType(type) {
  const form = $('#add-form');
  const keep = form.elements.type.value === type ? form.elements.category?.value : null;
  setTypeToggle(form, type);
  fillCategories($('#add-category'), type, keep);
  $('#add-note').placeholder = t(type === 'income' ? 'daily.occasionPhIncome' : 'daily.occasionPhExpense');
}

function initDaily() {
  const form = $('#add-form');
  $$('.type-toggle [data-type]', form).forEach((b) => b.addEventListener('click', () => updateAddFormType(b.dataset.type)));
  updateAddFormType('expense');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    busy(form, async () => {
      try {
        showFormError(form, null);
        const res = await withUnlock(() => post('/entries', { ...data, date: state.date }));
        if (!res) return;
        handleTargetUpdate(res.target);
        form.elements.note.value = '';
        form.elements.amount.value = '';
        form.elements.note.focus();
        toast(t('daily.added'));
        invalidateMarks();
        refreshSidebar();
        await loadDay();
      } catch (err) {
        if (err.status === 401) return handleError(err);
        showFormError(form, err);
      }
    });
  });

  $('#entry-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const entry = state.entries.find((x) => String(x.id) === btn.closest('[data-id]').dataset.id);
    if (btn.dataset.action === 'edit') editEntry(entry);
    if (btn.dataset.action === 'delete') deleteEntry(entry);
  });

  const go = (d) => loadDay(d > state.today ? state.today : d).catch(handleError);
  $('#week-prev').addEventListener('click', () => go(addDays(state.date, -7)));
  $('#week-next').addEventListener('click', () => go(addDays(state.date, 7)));
  $('#day-today').addEventListener('click', () => go(state.today));
  $('#day-open-cal').addEventListener('click', (e) =>
    openCalendar({ anchor: e.currentTarget, value: state.date, max: state.today, onSelect: go })
  );

  // Swipe the week strip to move a week
  let startX = null;
  const strip = $('#week-days');
  strip.addEventListener('touchstart', (e) => (startX = e.touches[0].clientX), { passive: true });
  strip.addEventListener('touchend', (e) => {
    const dx = startX === null ? 0 : e.changedTouches[0].clientX - startX;
    startX = null;
    if (Math.abs(dx) > 50) go(addDays(state.date, dx < 0 ? 7 : -7));
  });
}

async function editEntry(entry) {
  const dialog = $('#edit-dialog');
  const saved = await dialogAction(
    dialog,
    (data) => withUnlock(() => put(`/entries/${entry.id}`, Object.fromEntries(data))),
    {
      onOpen(form) {
        setTypeToggle(dialog, entry.type);
        const f = form.elements;
        const picker = $('#ed-category');
        fillCategories(picker, entry.type, entry.category);
        f.note.value = entry.note;
        // Edit in the currency the entry was saved in.
        f.amount.value = entry.converted ? entry.originalAmount : entry.amount;
        $('label[for=ed-amount]', dialog).textContent = t('daily.amount', { cur: currencySymbol(entry.currency) });
        const setDate = (d) => {
          f.date.value = d;
          $('#ed-date-label').textContent = fmt.date(d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        };
        setDate(entry.date);
        $('#ed-date').onclick = (e) => openCalendar({ anchor: e.currentTarget, value: f.date.value, max: state.today, onSelect: setDate });
        $$('.type-toggle [data-type]', dialog).forEach(
          (b) =>
            (b.onclick = () => {
              setTypeToggle(dialog, b.dataset.type);
              fillCategories(picker, b.dataset.type);
            })
        );
      },
    }
  ).catch(handleError);
  if (saved) {
    toast(t('daily.saved'));
    handleTargetUpdate(saved.target);
    invalidateMarks();
    refreshSidebar();
    loadDay().catch(handleError);
  }
}

async function deleteEntry(entry) {
  const dialog = $('#confirm-dialog');
  const done = await dialogAction(dialog, () => withUnlock(() => del(`/entries/${entry.id}`)), {
    onOpen: () => ($('#confirm-text').textContent = `${t('daily.confirmDelete')} (${entry.note} — ${fmt.money(entry.converted ? entry.originalAmount : entry.amount, entry.currency)})`),
  }).catch(handleError);
  if (done) {
    toast(t('daily.deleted'));
    handleTargetUpdate(done.target);
    invalidateMarks();
    refreshSidebar();
    loadDay().catch(handleError);
  }
}

// ---------- warnings from admin ----------
async function loadWarnings() {
  const { warnings } = await get('/warnings');
  const open = warnings.filter((w) => !w.acknowledged);
  $('#warnings').innerHTML = open
    .map(
      (w) => `
      <div class="alert" role="alert" data-id="${w.id}">
        <strong class="row">${icon('alert')} ${escapeHtml(t('warn.title'))}</strong> <span class="small muted">${fmt.dateTime(w.createdAt)}</span>
        <p style="margin: 0.4rem 0 0.6rem">${escapeHtml(w.message)}</p>
        <button class="btn" data-ack>${escapeHtml(t('warn.ack'))}</button>
      </div>`
    )
    .join('');
}
$('#warnings').addEventListener('click', async (e) => {
  if (!e.target.closest('[data-ack]')) return;
  const box = e.target.closest('[data-id]');
  await post(`/warnings/${box.dataset.id}/ack`).catch(handleError);
  box.remove();
});

// ---------- settings ----------
function renderSettings() {
  $('#set-name').value = state.user.displayName;
  $('#set-id').textContent = state.user.id;
  $$('#lang-toggle [data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === getLang())));
  $$('#theme-toggle [data-theme-choice]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeChoice === getTheme())));
  $('#reports-toggle').checked = !!state.user.reportsEnabled;
  widgets.forEach((w) => w.redraw());
  renderCurrencyCard();
  renderGoogleCard();
}

/** Accounts must confirm their own email (when the server can send email). */
function updateEmailGate() {
  const gate = $('#email-gate');
  const needed = emailState.emailEnabled && !state.user.emailVerified;
  gate.hidden = !needed;
  document.body.classList.toggle('gated', needed);
}

async function renderGoogleCard() {
  if (!(await googleAvailable())) return;
  const linked = state.user.googleEmail !== null;
  $('#google-card').hidden = false;
  $('#google-status').textContent = linked ? t('set.googleLinked', { email: state.user.googleEmail }) : t('set.googleNotLinked');
  $('#google-unlink').hidden = !linked;
  $('#google-link-btn').hidden = linked;
  if (!linked) {
    const ok = await renderGoogleButton($('#google-link-btn'), async (credential) => {
      try {
        setUser((await post('/auth/google/link', { credential })).user);
        toast(t('set.googleLinkedToast'));
        renderGoogleCard();
      } catch (err) {
        handleError(err);
      }
    });
    if (!ok) $('#google-card').hidden = true;
  }
}

function initSettings() {
  $$('#lang-toggle [data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
  $$('#theme-toggle [data-theme-choice]').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.themeChoice)));
  document.addEventListener('themechange', renderSettings);

  $('#profile-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    busy(form, async () => {
      try {
        showFormError(form, null);
        const { user } = await patch('/auth/profile', { displayName: form.elements.displayName.value });
        setUser(user);
        refreshSidebar();
        toast(t('set.nameSaved'));
      } catch (err) {
        showFormError(form, err);
      }
    });
  });

  $('#password-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    if (data.newPassword !== data.newPassword2) return showFormError(form, t('auth.mismatch'));
    busy(form, async () => {
      try {
        showFormError(form, null);
        await post('/auth/change-password', { currentPassword: data.currentPassword, newPassword: data.newPassword });
        form.reset();
        toast(t('set.passwordChanged'));
      } catch (err) {
        showFormError(form, err);
      }
    });
  });

  $('#google-unlink').addEventListener('click', async () => {
    const res = await dialogAction($('#unlink-dialog'), (data) => post('/auth/google/unlink', { password: data.get('password') }));
    if (!res) return;
    setUser(res.user);
    toast(t('set.googleUnlinkedToast'));
    renderGoogleCard();
  });

  $('#reports-toggle').addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    try {
      setUser((await put('/account/reports', { enabled })).user);
      toast(t(enabled ? 'email.reportsOn' : 'email.reportsOff'));
    } catch (err) {
      e.target.checked = !enabled;
      handleError(err);
    }
  });

  $('#replay-tour').addEventListener('click', () => startOnboarding());
  $('#logout-btn').addEventListener('click', async () => {
    await post('/auth/logout').catch(() => {});
    location.replace('/');
  });
  $('#delete-account').addEventListener('click', async () => {
    const done = await dialogAction($('#delete-account-dialog'), (data) => del('/auth/account', { password: data.get('password') }));
    if (done) location.replace('/');
  });
}

// ---------- boot ----------
async function boot() {
  initChrome();
  let me;
  try {
    me = await get('/auth/me');
  } catch {
    location.replace('/');
    return;
  }
  if (me.user.role === 'admin') {
    location.replace('/admin');
    return;
  }
  setUser(me.user);
  emailState.pendingEmail = me.pendingEmail;
  emailState.emailEnabled = me.emailEnabled;
  state.today = me.user.today;
  state.date = me.user.today;
  state.unlockedUntil = me.unlockedUntil || 0;

  initDaily();
  initReports({ getToday: () => state.today, onError: handleError });
  initSettings();
  initSidebar({ getUser: () => state.user, getToday: () => state.today, onError: handleError });
  initTarget({ onError: handleError, onTargetChange: refreshSidebar });
  initConvert({ getUser: () => state.user, getToday: () => state.today, onUser: setUser, onError: handleError });

  const onVerified = () => {
    updateEmailGate();
    widgets.forEach((w) => w.redraw());
    if (!state.user.onboarded) startOnboarding(() => post('/auth/onboarded').catch(() => {}));
  };
  widgets.push(renderEmailWidget($('#email-widget'), emailState, onVerified));
  widgets.push(renderEmailWidget($('#gate-widget'), emailState, onVerified));
  $('#gate-logout').addEventListener('click', async () => {
    await post('/auth/logout').catch(() => {});
    location.replace('/');
  });
  updateEmailGate();

  showView(location.hash.slice(1) || 'daily');
  await Promise.all([loadDay(), loadWarnings(), loadTarget()]).catch(handleError);

  // Emails and PDF reports use the language picked in the app.
  const syncLang = () => (state.user.lang !== getLang() ? put('/account/lang', { lang: getLang() }).then(() => (state.user.lang = getLang())) : null);
  syncLang()?.catch(() => {});

  onLangChange(() => {
    syncLang()?.catch(() => {});
    renderTarget();
    widgets.forEach((w) => w.redraw());
    refreshSidebar();
    renderDayHeader();
    renderEntries(lastTotals);
    updateAddFormType($('#add-form').elements.type.value);
    if (state.view === 'reports') loadReports().catch(handleError);
    if (state.view === 'settings') renderSettings();
    if (state.view === 'convert') loadConvert().catch(handleError);
    loadWarnings().catch(() => {});
  });

  if (!state.user.onboarded && $('#email-gate').hidden) {
    startOnboarding(() => post('/auth/onboarded').catch(() => {}));
  }
}

boot();
