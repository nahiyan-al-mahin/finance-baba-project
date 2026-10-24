// Monthly spending target card (Daily page) and the over-target alert.
import { get, put, del } from './api.js';
import { t, fmt } from './i18n.js';
import { $, escapeHtml, toast, dialogAction } from './ui.js';
import { icon } from './icons.js';

let status = null;
let onChange = () => {};
let reportError = () => {};

const monthLabel = (month) => fmt.monthYear(`${month}-01`);
const editUntil = (month, days) => fmt.date(`${month}-${String(days).padStart(2, '0')}`, { day: 'numeric', month: 'long' });
function nextWindow(month) {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return fmt.date(d.toISOString().slice(0, 10), { day: 'numeric', month: 'long' });
}

export const targetStatus = () => status;

function render() {
  const body = $('#target-body');
  const badge = $('#target-badge');
  if (!status) return;
  const s = status;
  const month = monthLabel(s.month);

  if (s.amount === null) {
    // No target: say so plainly, so people know the feature exists and when they can use it.
    badge.hidden = false;
    badge.className = 'badge';
    badge.textContent = t('tgt.badgeNone');
    body.innerHTML = `
      <div class="target-empty">
        <strong>${escapeHtml(t('tgt.noneTitle', { month }))}</strong>
        <span class="small muted">${escapeHtml(t('tgt.spentSoFar', { spent: fmt.money(s.spent) }))}</span>
      </div>
      ${
        s.canEdit
          ? `<p class="small">${escapeHtml(t('tgt.canSet', { date: editUntil(s.month, s.editDays) }))}</p>
             <button class="btn btn-primary btn-sm" type="button" data-target-edit>${icon('target')} ${escapeHtml(t('tgt.set'))}</button>`
          : `<p class="small muted">${icon('lock')} ${escapeHtml(t('tgt.lockedNone', { date: nextWindow(s.month) }))}</p>`
      }`;
    return;
  }

  const pct = Math.min(100, (s.spent / s.amount) * 100);
  const level = s.over ? 'over' : pct >= 80 ? 'warn' : '';
  badge.hidden = false;
  badge.className = `badge ${s.over ? 'flag' : 'unlocked'}`;
  badge.innerHTML = `${icon(s.over ? 'alert' : 'check-circle')} ${escapeHtml(t(s.over ? 'tgt.badgeOver' : 'tgt.badgeOk'))}`;
  body.innerHTML = `
    <div class="target-numbers">
      <strong class="num">${escapeHtml(t('tgt.spentOf', { spent: fmt.money(s.spent), target: fmt.money(s.amount) }))}</strong>
      <span class="${s.over ? 'expense' : 'muted'} small">${escapeHtml(
        s.over ? t('tgt.overBy', { amount: fmt.money(s.spent - s.amount) }) : t('tgt.left', { amount: fmt.money(s.amount - s.spent) })
      )}</span>
    </div>
    <div class="meter target-meter" aria-hidden="true"><span class="${level}" style="width:${Math.max(2, pct)}%"></span></div>
    <div class="row-between wrap small muted">
      <span>${icon(s.canEdit ? 'unlock' : 'lock')} ${escapeHtml(s.canEdit ? t('tgt.editable', { date: editUntil(s.month, s.editDays) }) : t('tgt.locked'))}</span>
      ${s.canEdit ? `<button class="btn btn-sm" type="button" data-target-edit>${icon('pencil')} ${escapeHtml(t('tgt.edit'))}</button>` : ''}
    </div>`;
}

export async function loadTarget() {
  status = await get('/account/target');
  render();
  return status;
}

/** Called with the `target` object returned when entries change. */
export function handleTargetUpdate(result) {
  if (!result || !status || result.month !== status.month) return;
  status = { ...status, amount: result.amount, spent: result.spent, over: result.over };
  render();
  if (result.newlyOver) alertOver(result);
}

function alertOver(r) {
  const body = t('tgt.overBody', { spent: fmt.money(r.spent), amount: fmt.money(r.spent - r.amount), target: fmt.money(r.amount) });
  toast(`${t('tgt.overTitle')} ${body}`, 'error');
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(t('tgt.overTitle'), { body, icon: '/img/logo.svg', tag: `target-${r.month}` });
    }
  } catch {
    // some mobile browsers only allow notifications from a service worker; the toast is enough
  }
}

async function editTarget() {
  const dialog = $('#target-dialog');
  const saved = await dialogAction(
    dialog,
    async (data) => {
      const res = await put('/account/target', { amount: data.get('amount') });
      // Ask once for permission to show a system notification when the target is crossed.
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
      return res;
    },
    {
      onOpen(form) {
        $('#target-dialog-title').textContent = t('tgt.dialogTitle', { month: monthLabel(status.month) });
        form.elements.amount.value = status.amount ?? '';
        $('#target-remove').hidden = status.amount === null;
      },
    }
  ).catch((err) => reportError(err));
  if (saved) {
    status = saved;
    render();
    toast(t('tgt.saved'));
    onChange();
  }
}

export function initTarget({ onError, onTargetChange }) {
  onChange = onTargetChange || onChange;
  reportError = onError;
  $('#target-body').addEventListener('click', (e) => {
    if (e.target.closest('[data-target-edit]')) editTarget();
  });
  $('#target-remove').addEventListener('click', async () => {
    try {
      status = await del('/account/target');
      $('#target-dialog').close();
      render();
      toast(t('tgt.removed'));
      onChange();
    } catch (err) {
      onError(err);
    }
  });
}

export const renderTarget = render;
