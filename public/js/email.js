// Email address widget: enter address → receive 6-digit code → confirm. Used in Settings and on the email gate.
import { post } from './api.js';
import { t } from './i18n.js';
import { escapeHtml, showFormError, busy, toast } from './ui.js';
import { icon } from './icons.js';

/**
 * @param {HTMLElement} el
 * @param {{ user: object, pendingEmail: string|null, emailEnabled: boolean }} state  mutated in place
 * @param {(user: object) => void} onVerified
 */
export function renderEmailWidget(el, state, onVerified) {
  let mode = state.pendingEmail ? 'code' : state.user.emailVerified ? 'verified' : 'enter';

  function draw() {
    if (!state.emailEnabled) {
      el.innerHTML = `<p class="small muted">${state.user.email ? escapeHtml(t('email.verified', { email: state.user.email })) + ' · ' : ''}${escapeHtml(t('email.notConfigured'))}</p>`;
      return;
    }
    if (mode === 'verified') {
      el.innerHTML = `
        <div class="email-ok">
          <span class="badge unlocked">${icon('check-circle')} ${escapeHtml(t('email.verified', { email: state.user.email }))}</span>
          <button type="button" class="btn btn-sm" data-act="change">${escapeHtml(t('email.change'))}</button>
        </div>`;
    } else if (mode === 'enter') {
      el.innerHTML = `
        <form class="email-form" novalidate>
          <div class="field">
            <label for="${el.id}-email">${escapeHtml(t('email.address'))}</label>
            <input class="input" id="${el.id}-email" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" required />
          </div>
          <div class="row wrap">
            <button class="btn btn-primary" type="submit">${icon('mail')} ${escapeHtml(t('email.send'))}</button>
            ${state.user.emailVerified ? `<button type="button" class="btn btn-ghost" data-act="cancel">${escapeHtml(t('daily.cancel'))}</button>` : ''}
          </div>
        </form>`;
      const form = el.querySelector('form');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        busy(form, async () => {
          try {
            showFormError(form, null);
            const { pendingEmail } = await post('/account/email', { email: form.elements.email.value });
            state.pendingEmail = pendingEmail;
            mode = 'code';
            draw();
          } catch (err) {
            showFormError(form, err);
          }
        });
      });
    } else {
      el.innerHTML = `
        <form class="email-form" novalidate>
          <p class="small">${escapeHtml(t('email.codeSent', { email: state.pendingEmail }))}</p>
          <div class="field">
            <label for="${el.id}-code">${escapeHtml(t('email.code'))}</label>
            <input class="input code-input" id="${el.id}-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="••••••" required />
          </div>
          <div class="row wrap">
            <button class="btn btn-primary" type="submit">${escapeHtml(t('email.verify'))}</button>
            <button type="button" class="btn btn-sm" data-act="resend">${escapeHtml(t('email.resend'))}</button>
            <button type="button" class="btn btn-ghost btn-sm" data-act="other">${escapeHtml(t('email.other'))}</button>
          </div>
        </form>`;
      const form = el.querySelector('form');
      form.elements.code.focus();
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        busy(form, async () => {
          try {
            showFormError(form, null);
            const { user } = await post('/account/email/verify', { code: form.elements.code.value });
            Object.assign(state.user, user);
            state.pendingEmail = null;
            mode = 'verified';
            draw();
            toast(t('email.verifiedToast'));
            onVerified?.(state.user);
          } catch (err) {
            showFormError(form, err);
          }
        });
      });
    }
  }

  el.onclick = async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'change' || act === 'other') {
      mode = 'enter';
      draw();
    } else if (act === 'cancel') {
      mode = 'verified';
      draw();
    } else if (act === 'resend') {
      const form = el.querySelector('form');
      try {
        showFormError(form, null);
        await post('/account/email', { email: state.pendingEmail });
        toast(t('email.codeSent', { email: state.pendingEmail }));
      } catch (err) {
        showFormError(form, err);
      }
    }
  };

  draw();
  return {
    // Another widget may have changed the shared state (e.g. verified on the gate): follow it.
    redraw() {
      if (mode === 'code' && !state.pendingEmail) mode = state.user.emailVerified ? 'verified' : 'enter';
      else if (state.pendingEmail && mode === 'verified') mode = 'code';
      draw();
    },
  };
}
