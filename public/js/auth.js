import { get, post } from './api.js';
import { t } from './i18n.js';
import { $, $$, initChrome, showFormError, busy, toast, downloadText } from './ui.js';

initChrome();

const goHome = (user) => location.replace(user.role === 'admin' ? '/admin' : '/app');

// Already logged in? Skip the login page.
get('/auth/me')
  .then(({ user }) => goHome(user))
  .catch(() => {});

function show(panel) {
  $('#panel-main').hidden = panel !== 'main';
  $('#recover-form').hidden = panel !== 'recover';
  $('#panel-recovery').hidden = panel !== 'recovery';
}

function switchTab(tab) {
  $$('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
  $('#login-form').hidden = tab !== 'login';
  $('#signup-form').hidden = tab !== 'signup';
  $(tab === 'login' ? '#login-username' : '#su-name').focus();
}

$$('[data-tab]').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
if (location.hash === '#signup') switchTab('signup');

$('#show-recover').addEventListener('click', (e) => {
  e.preventDefault();
  show('recover');
});
$('#back-to-login').addEventListener('click', (e) => {
  e.preventDefault();
  show('main');
});

$('#login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  busy(form, async () => {
    try {
      showFormError(form, null);
      const { user } = await post('/auth/login', data);
      goHome(user);
    } catch (err) {
      showFormError(form, err);
    }
  });
});

$('#signup-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  if (data.password !== data.password2) return showFormError(form, t('auth.mismatch'));
  busy(form, async () => {
    try {
      showFormError(form, null);
      const { user, recoveryCode } = await post('/auth/signup', {
        displayName: data.displayName,
        username: data.username,
        password: data.password,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      showRecovery(user, recoveryCode);
    } catch (err) {
      showFormError(form, err);
    }
  });
});

$('#recover-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  busy(form, async () => {
    try {
      showFormError(form, null);
      const { user, recoveryCode } = await post('/auth/recover', Object.fromEntries(new FormData(form)));
      showRecovery(user, recoveryCode);
    } catch (err) {
      showFormError(form, err);
    }
  });
});

function showRecovery(user, code) {
  show('recovery');
  $('#recovery-code').textContent = code;
  $('#copy-code').onclick = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast(t('recovery.copied'));
    } catch {
      getSelection().selectAllChildren($('#recovery-code'));
    }
  };
  $('#download-code').onclick = () =>
    downloadText('finance-baba-recovery-code.txt', `${t('appName')}\n${t('auth.recoveryCode')}: ${code}\n\n${t('recovery.body')}\n`);
  $('#saved-check').onchange = (e) => ($('#continue-btn').disabled = !e.target.checked);
  $('#continue-btn').onclick = () => goHome(user);
}
