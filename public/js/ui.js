// Shared UI helpers: toasts, dialogs, header toggles, error messages.
import { t, setLang, getLang, applyI18n } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function errorMessage(err) {
  if (err?.code === 'ACCOUNT_LOCKED') return t('err.ACCOUNT_LOCKED', { min: Math.max(1, Math.ceil((err.data?.retryAfterSec || 60) / 60)) });
  const key = `err.${err?.code}`;
  const msg = t(key);
  return msg === key ? t('err.generic') : msg;
}

export function toast(message, type = 'info') {
  let wrap = $('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');
    document.body.append(wrap);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  wrap.append(el);
  setTimeout(() => el.remove(), 3500);
}

export function showFormError(form, err) {
  let box = $('.form-error', form);
  if (!err) {
    box?.remove();
    return;
  }
  if (!box) {
    box = document.createElement('div');
    box.className = 'form-error';
    box.setAttribute('role', 'alert');
    form.prepend(box);
  }
  box.textContent = typeof err === 'string' ? err : errorMessage(err);
}

/** Disables a form's submit button while `fn` runs. */
export async function busy(form, fn) {
  const btn = $('[type=submit]', form);
  if (btn) btn.disabled = true;
  try {
    return await fn();
  } finally {
    if (btn) btn.disabled = false;
  }
}

export function setTheme(theme) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  try {
    localStorage.setItem('fb-theme', document.documentElement.dataset.theme);
  } catch {}
  document.dispatchEvent(new CustomEvent('themechange'));
}

export const getTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');



/** Wires the language and theme buttons found in the top bar. */
export function initChrome() {
  $$('[data-action=toggle-lang]').forEach((b) => b.addEventListener('click', () => setLang(getLang() === 'bn' ? 'en' : 'bn')));
  $$('[data-action=toggle-theme]').forEach((b) => b.addEventListener('click', () => setTheme(getTheme() === 'dark' ? 'light' : 'dark')));
  $$('.toggle-pw').forEach((b) =>
    b.addEventListener('click', () => {
      const input = b.previousElementSibling;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.dataset.i18n = show ? 'auth.hide' : 'auth.show';
      b.textContent = t(b.dataset.i18n);
    })
  );
  applyI18n();
}

/** Opens a <dialog> and resolves with the submitted FormData, or null if cancelled. */
export function openDialog(dialog, { onOpen } = {}) {
  const form = $('form', dialog);
  form.reset();
  showFormError(form, null);
  applyI18n(dialog);
  onOpen?.(form);
  if (!dialog.dataset.wired) {
    dialog.dataset.wired = '1';
    dialog.addEventListener('click', (e) => {
      if (e.target.closest('[data-action=cancel]')) dialog.close();
    });
  }
  dialog.showModal();
  $('input:not([type=hidden]), textarea, select', form)?.focus();
  return waitForSubmit(dialog, form);
}

/**
 * Keeps a dialog open and retries `action(data)` until it succeeds or the user cancels.
 * Returns the action's result, or null when cancelled.
 */
export async function dialogAction(dialog, action, opts) {
  let result = await openDialog(dialog, opts);
  while (result) {
    try {
      const value = await busy(result.form, () => action(result.data));
      result.close();
      return value;
    } catch (err) {
      showFormError(result.form, err);
      result = await waitForSubmit(dialog, result.form);
    }
  }
  return null;
}

function waitForSubmit(dialog, form) {
  return new Promise((resolve) => {
    const onSubmit = (e) => {
      e.preventDefault();
      done();
      resolve({ data: new FormData(form), form, close: () => dialog.close() });
    };
    const onClose = () => {
      done();
      resolve(null);
    };
    function done() {
      form.removeEventListener('submit', onSubmit);
      dialog.removeEventListener('close', onClose);
    }
    form.addEventListener('submit', onSubmit);
    dialog.addEventListener('close', onClose);
  });
}

export function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
