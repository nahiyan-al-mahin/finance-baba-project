import { get, post } from './api.js';
import { t, fmt, onLangChange } from './i18n.js';
import { $, initChrome, toast, errorMessage, dialogAction, escapeHtml } from './ui.js';

let users = [];
let warnings = [];

function renderStats(s) {
  $('#st-total').textContent = fmt.number(s.totalUsers);
  $('#st-active').textContent = fmt.number(s.activeLast7Days);
  $('#st-new').textContent = fmt.number(s.newLast30Days);
  $('#st-locked').textContent = fmt.number(s.lockedNow);
}

function renderUsers() {
  const cell = (key, value) => `<td data-label="${escapeHtml(t(key))}">${value}</td>`;
  $('#user-rows').innerHTML = users.length
    ? users
        .map(
          (u) => `
      <tr>
        ${cell('adm.id', `<strong>${escapeHtml(u.id)}</strong>`)}
        ${cell('adm.joined', fmt.dateTime(u.createdAt))}
        ${cell('adm.lastActive', fmt.dateTime(u.lastActiveAt))}
        ${cell('adm.entries', fmt.number(u.entryCount))}
        ${cell('adm.entries24', fmt.number(u.entriesLast24h))}
        ${cell('adm.failed', fmt.number(u.failedLogins))}
        ${cell('adm.pastEdits', fmt.number(u.pastEdits))}
        ${cell('adm.flags', u.flags.map((f) => `<span class="badge flag">${escapeHtml(t(`flag.${f}`))}</span>`).join(' ') || '–')}
        <td><button class="btn" data-warn="${escapeHtml(u.id)}">⚠️ ${escapeHtml(t('adm.warn'))}${u.warnings ? ` (${fmt.number(u.warnings)})` : ''}</button></td>
      </tr>`
        )
        .join('')
    : `<tr><td colspan="9" class="empty">${escapeHtml(t('adm.none'))}</td></tr>`;
}

function renderWarnings() {
  $('#warning-list').innerHTML = warnings.length
    ? warnings
        .map(
          (w) => `
      <li class="entry">
        <span class="entry-icon">${w.acknowledged ? '✅' : '⏳'}</span>
        <div class="entry-body">
          <div class="entry-note">${escapeHtml(w.message)}</div>
          <div class="entry-meta">${escapeHtml(w.userId)} · ${fmt.dateTime(w.createdAt)} · ${escapeHtml(t(w.acknowledged ? 'adm.ackd' : 'adm.pending'))}</div>
        </div>
      </li>`
        )
        .join('')
    : `<li class="empty">${escapeHtml(t('adm.noWarnings'))}</li>`;
}

async function load() {
  const [stats, u, w] = await Promise.all([get('/admin/stats'), get('/admin/users'), get('/admin/warnings')]);
  users = u.users;
  warnings = w.warnings;
  renderStats(stats);
  renderUsers();
  renderWarnings();
}

$('#user-rows').addEventListener('click', async (e) => {
  const id = e.target.closest('[data-warn]')?.dataset.warn;
  if (!id) return;
  const sent = await dialogAction($('#warn-dialog'), (data) => post(`/admin/users/${encodeURIComponent(id)}/warnings`, { message: data.get('message') }), {
    onOpen: () => ($('#warn-title').textContent = t('adm.warnTitle', { id })),
  });
  if (sent) {
    toast(t('adm.sent'));
    load().catch(onError);
  }
});

$('#logout-btn').addEventListener('click', async () => {
  await post('/auth/logout').catch(() => {});
  location.replace('/');
});

function onError(err) {
  if (err.status === 401 || err.status === 403) return location.replace('/');
  toast(errorMessage(err), 'error');
}

initChrome();
onLangChange(() => load().catch(onError));
load().catch(onError);
