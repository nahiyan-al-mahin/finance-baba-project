// "Continue with Google" button using Google Identity Services.
// Hidden automatically when the server has no GOOGLE_CLIENT_ID configured.
import { get } from './api.js';
import { getLang, onLangChange } from './i18n.js';
import { getTheme } from './ui.js';

let configPromise;
let scriptPromise;
let initializedFor = null;
let onCredential = () => {};
const rendered = new Set();

function clientId() {
  configPromise ||= get('/auth/config')
    .then((c) => c.googleClientId)
    .catch(() => null);
  return configPromise;
}

function loadScript() {
  scriptPromise ||= new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src: 'https://accounts.google.com/gsi/client', async: true });
    s.onload = resolve;
    s.onerror = reject;
    document.head.append(s);
  });
  return scriptPromise;
}

function draw(el) {
  el.innerHTML = '';
  window.google.accounts.id.renderButton(el, {
    type: 'standard',
    theme: getTheme() === 'dark' ? 'filled_black' : 'outline',
    size: 'large',
    text: 'continue_with',
    shape: 'pill',
    logo_alignment: 'center',
    locale: getLang(),
    width: Math.min(400, Math.max(200, el.clientWidth || 320)),
  });
}

export const googleAvailable = async () => !!(await clientId());

/**
 * Renders the Google button into `el` and calls `callback(credential)` after the user picks an account.
 * Resolves to false (and renders nothing) when Google sign-in is not available.
 */
export async function renderGoogleButton(el, callback) {
  const id = await clientId();
  if (!id) return false;
  try {
    await loadScript();
    onCredential = callback;
    if (initializedFor !== id) {
      window.google.accounts.id.initialize({ client_id: id, callback: (res) => onCredential(res.credential), ux_mode: 'popup' });
      initializedFor = id;
    }
    draw(el);
  } catch {
    return false; // blocked or offline: the page keeps working with username + password
  }
  rendered.add(el);
  return true;
}

const redrawAll = () => rendered.forEach((el) => el.isConnected && el.offsetParent !== null && draw(el));
onLangChange(redrawAll);
document.addEventListener('themechange', redrawAll);
