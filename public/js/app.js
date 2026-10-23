import { get, post, put, patch, del } from './api.js';
import { t, fmt, setLang, getLang, onLangChange, applyI18n, categoryLabel, categoryIcon } from './i18n.js';
import { $, $$, initChrome, toast, errorMessage, showFormError, busy, openDialog, dialogAction, escapeHtml, setTheme, getTheme } from './ui.js';
import { initReports, loadReports } from './reports.js';
import { startOnboarding } from './onboarding.js';

const state = { user: null, today: null, date: null, unlockedUntil: 0, view: 'daily', entries: [] };

// ---------- helpers ----------
function handleError(err) {
  if (err?.status === 401 && err.code === 'UNAUTHENTICATED') {
    location.replace('/');
    return;
  }
  toast(errorMessage(err), 'error');
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function fillCategories(select, type, selected) {
  select.innerHTML = window.FB_CATEGORIES[type].map((c) => `<option value="${c.id}">${c.icon} ${escapeHtml(c[getLang()])}</option>`).join('');
  if (selected) select.value = selected;
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
  if (!['daily', 'reports', 'settings'].includes(view)) view = 'daily';
  state.view = view;
  $$('main > section').forEach((s) => (s.hidden = s.id !== `view-${view}`));
  $$('[data-view]').forEach((b) => (b.getAttribute('data-view') === view ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  document.body.dataset.titleKey = `nav.${view}`;
  applyI18n();
  if (view === 'reports') loadReports().catch(handleError);
  if (view === 'settings') renderSettings();
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
  $('#day-title').textContent = isToday ? `${t('daily.today')} · ${fmt.date(state.date)}` : fmt.longDate(state.date);
  const badge = $('#day-badge');
  const unlocked = state.unlockedUntil > Date.now();
  badge.className = `badge ${isToday ? 'today' : unlocked ? '' : 'locked'}`;
  badge.textContent = isToday ? fmt.date(state.date, { weekday: 'long' }) : unlocked ? `🔓 ${t('daily.unlocked')}` : `🔒 ${t('daily.pastLocked')}`;
  $('#day-next').disabled = state.date >= state.today;
  $('#day-picker').value = state.date;
  $('#day-picker').max = state.today;
  $('#day-today').hidden = isToday;
  $('#day-total-label').textContent = t(isToday ? 'daily.totalSpentToday' : 'daily.totalSpent');
}

function renderEntries(totals) {
  $('#day-expense').textContent = fmt.money(totals.expense);
  $('#day-income').textContent = fmt.money(totals.income);
  $('#day-net').textContent = fmt.money(totals.net);
  $('#day-total').textContent = fmt.money(totals.expense);
  const list = $('#entry-list');
  if (!state.entries.length) {
    list.innerHTML = `<li class="empty"><div class="big">🗒️</div>${escapeHtml(t('daily.empty'))}</li>`;
    return;
  }
  list.innerHTML = state.entries
    .map(
      (e) => `
      <li class="entry" data-id="${e.id}">
        <span class="entry-icon" aria-hidden="true">${categoryIcon(e.type, e.category)}</span>
        <div class="entry-body">
          <div class="entry-note">${escapeHtml(e.note)}</div>
          <div class="entry-meta">${escapeHtml(categoryLabel(e.type, e.category))} · ${fmt.time(e.createdAt)}</div>
        </div>
        <span class="entry-amount ${e.type}">${e.type === 'income' ? '+' : '−'}${fmt.money(e.amount)}</span>
        <span class="entry-actions">
          <button class="icon-btn" data-action="edit" title="${escapeHtml(t('daily.edit'))}" aria-label="${escapeHtml(t('daily.edit'))}">✏️</button>
          <button class="icon-btn" data-action="delete" title="${escapeHtml(t('daily.delete'))}" aria-label="${escapeHtml(t('daily.delete'))}">🗑️</button>
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
  setTypeToggle(form, type);
  fillCategories($('#add-category'), type);
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
        form.elements.note.value = '';
        form.elements.amount.value = '';
        form.elements.note.focus();
        toast(t('daily.added'));
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

  $('#day-prev').addEventListener('click', () => loadDay(addDays(state.date, -1)).catch(handleError));
  $('#day-next').addEventListener('click', () => loadDay(addDays(state.date, 1)).catch(handleError));
  $('#day-today').addEventListener('click', () => loadDay(state.today).catch(handleError));
  $('#day-picker').addEventListener('change', (e) => e.target.value && loadDay(e.target.value).catch(handleError));
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
        fillCategories(f.category, entry.type, entry.category);
        f.note.value = entry.note;
        f.amount.value = entry.amount;
        f.date.value = entry.date;
        f.date.max = state.today;
        $$('.type-toggle [data-type]', dialog).forEach(
          (b) =>
            (b.onclick = () => {
              setTypeToggle(dialog, b.dataset.type);
              fillCategories(f.category, b.dataset.type);
            })
        );
      },
    }
  ).catch(handleError);
  if (saved) {
    toast(t('daily.saved'));
    loadDay().catch(handleError);
  }
}

async function deleteEntry(entry) {
  const dialog = $('#confirm-dialog');
  const done = await dialogAction(dialog, () => withUnlock(() => del(`/entries/${entry.id}`)), {
    onOpen: () => ($('#confirm-text').textContent = `${t('daily.confirmDelete')} (${entry.note} — ${fmt.money(entry.amount)})`),
  }).catch(handleError);
  if (done) {
    toast(t('daily.deleted'));
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
        <strong>⚠️ ${escapeHtml(t('warn.title'))}</strong> <span class="small muted">${fmt.dateTime(w.createdAt)}</span>
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
        state.user = user;
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
  state.user = me.user;
  state.today = me.user.today;
  state.date = me.user.today;
  state.unlockedUntil = me.unlockedUntil || 0;

  initDaily();
  initReports({ getToday: () => state.today, onError: handleError });
  initSettings();
  showView(location.hash.slice(1) || 'daily');
  await Promise.all([loadDay(), loadWarnings()]).catch(handleError);

  onLangChange(() => {
    renderDayHeader();
    renderEntries(lastTotals);
    updateAddFormType($('#add-form').elements.type.value);
    if (state.view === 'reports') loadReports().catch(handleError);
    if (state.view === 'settings') renderSettings();
    loadWarnings().catch(() => {});
  });

  if (!state.user.onboarded) {
    startOnboarding(() => post('/auth/onboarded').catch(() => {}));
  }
}

boot();
