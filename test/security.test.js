'use strict';
// Black-box security checks: headers, cookies, access control between users, CSRF, injection, brute force,
// sessions, and the Android/PWA files. Runs the app in production mode.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-sec-'));
process.env.DATA_DIR = tmp;
process.env.APP_SECRET = 'c'.repeat(64);
process.env.NODE_ENV = 'production';
process.env.AUTH_RATE_LIMIT = '1000'; // the per-account lockout is what's tested below
process.env.ANDROID_CERT_SHA256 = 'AB:'.repeat(31) + 'CD';
require('../server/rates').setRatesForTests({ BDT: 120, USD: 1 });
const app = require('../server/app');
const db = require('../server/db');

let server;
let B;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  B = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });
function client() {
  let cookie = '';
  const fn = async (method, url, body, headers = {}) => {
    const res = await fetch(B + url, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'FinanceBaba', ...(cookie && { Cookie: cookie }), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set) { fn.rawCookie = set; cookie = set.split(';')[0]; }
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, headers: res.headers, body: json, text };
  };
  fn.cookie = () => cookie;
  return fn;
}
test('security checks', async () => {
  // ---- 1. Security headers on pages and API
  for (const path of ['/', '/app', '/api/auth/config', '/privacy', '/sw.js']) {
    const r = await fetch(B + path); const h = r.headers;
    check(`headers ${path}: CSP`, /default-src 'self'/.test(h.get('content-security-policy') || ''), h.get('content-security-policy')?.slice(0, 60));
    check(`headers ${path}: HSTS`, /max-age=\d{7,}/.test(h.get('strict-transport-security') || ''), h.get('strict-transport-security'));
    check(`headers ${path}: nosniff`, h.get('x-content-type-options') === 'nosniff');
    check(`headers ${path}: clickjacking blocked`, /frame-ancestors 'none'/.test(h.get('content-security-policy') || '') || h.get('x-frame-options'));
    check(`headers ${path}: no X-Powered-By`, !h.get('x-powered-by'));
  }
  const api = await fetch(B + '/api/auth/config');
  check('API responses are not cached', /no-store/.test(api.headers.get('cache-control') || ''));

  // ---- 2. Sign up two users; cookie flags
  const a = client(), b = client(), anon = client();
  let r = await a('POST', '/api/auth/signup', { email: 'a@sec.test', username: 'alicesec', displayName: '<img src=x onerror=alert(1)>', password: 'alice12345', timezone: 'Asia/Dhaka' });
  check('signup works', r.status === 201, r.status);
  const ck = a.rawCookie || '';
  check('session cookie HttpOnly', /HttpOnly/i.test(ck)); check('session cookie Secure', /Secure/i.test(ck)); check('session cookie SameSite=Strict', /SameSite=Strict/i.test(ck));
  await b('POST', '/api/auth/signup', { email: 'b@sec.test', username: 'bobsec', displayName: 'Bob', password: 'bob1234567', timezone: 'Asia/Dhaka' });
  const today = (await a('GET', '/api/auth/me')).body.user.today;

  // Alice creates data of every kind
  const entry = (await a('POST', '/api/entries', { date: today, type: 'expense', amount: 100, category: 'food', note: '<script>alert(1)</script>' })).body.entry;
  const loan = (await a('POST', '/api/loans', { direction: 'lent', person: '"><svg onload=alert(1)>', amount: 500, date: today })).body.loan;
  await a('POST', `/api/loans/${loan.id}/payments`, { amount: 100, date: today });
  const pay = (await a('GET', '/api/loans')).body.loans[0].payments[0];
  const saving = (await a('POST', '/api/savings', { type: 'deposit', amount: 1000, date: today, note: 'x' })).body.log;
  check('test data created', entry && loan && pay && saving);

  // ---- 3. Every protected route refuses anonymous users
  const protectedRoutes = [
    ['GET', '/api/auth/me'], ['GET', '/api/entries'], ['POST', '/api/entries'], ['PUT', `/api/entries/${entry.id}`], ['DELETE', `/api/entries/${entry.id}`],
    ['GET', '/api/loans'], ['POST', '/api/loans'], ['PUT', `/api/loans/${loan.id}`], ['POST', `/api/loans/${loan.id}/payments`], ['DELETE', `/api/loans/${loan.id}/payments/${pay.id}`], ['DELETE', `/api/loans/${loan.id}`],
    ['GET', '/api/savings'], ['POST', '/api/savings'], ['DELETE', `/api/savings/${saving.id}`],
    ['GET', '/api/account/fx'], ['PUT', '/api/account/currency'], ['GET', '/api/account/target'], ['PUT', '/api/account/target'], ['PUT', '/api/account/reports'],
    ['GET', '/api/reports/summary?period=month'], ['GET', '/api/reports/pdf?period=month'], ['GET', '/api/warnings'],
    ['GET', '/api/admin/stats'], ['GET', '/api/admin/users'], ['POST', '/api/auth/unlock'], ['POST', '/api/auth/change-password'], ['DELETE', '/api/auth/account'], ['PATCH', '/api/auth/profile'],
  ];
  for (const [m, u] of protectedRoutes) { r = await anon(m, u, m === 'GET' ? undefined : {}); check(`anonymous ${m} ${u} -> 401`, r.status === 401, r.status); }

  // ---- 4. Bob cannot read or change Alice's data (IDOR)
  const idor = [
    ['PUT', `/api/entries/${entry.id}`, { date: today, type: 'expense', amount: 1, category: 'food', note: 'pwn' }], ['DELETE', `/api/entries/${entry.id}`],
    ['PUT', `/api/loans/${loan.id}`, { person: 'pwn', amount: 999, date: today }], ['POST', `/api/loans/${loan.id}/payments`, { amount: 1, date: today }],
    ['DELETE', `/api/loans/${loan.id}/payments/${pay.id}`], ['DELETE', `/api/loans/${loan.id}`], ['DELETE', `/api/savings/${saving.id}`],
  ];
  for (const [m, u, body] of idor) { r = await b(m, u, body || {}); check(`other user ${m} ${u} -> 404`, r.status === 404, r.status); }
  r = await b('GET', '/api/loans'); check("other user sees none of Alice's loans", r.body.loans.length === 0);
  r = await b('GET', '/api/savings'); check("other user sees none of Alice's savings", r.body.logs.length === 0 && r.body.balance === 0);
  r = await b('GET', `/api/entries?date=${today}`); check("other user sees none of Alice's entries", r.body.entries.length === 0);
  r = await a('GET', '/api/loans'); check("Alice's loan untouched", r.body.loans[0].amount === 500 && r.body.loans[0].payments.length === 1);
  r = await b('GET', '/api/admin/stats'); check('normal user cannot open admin', r.status === 403, r.status);

  // ---- 5. CSRF: state-changing request without the custom header, or from another origin
  const noHeader = await fetch(B + '/api/loans', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: a.cookie() }, body: JSON.stringify({ direction: 'lent', person: 'csrf', amount: 1, date: today }) });
  check('CSRF: request without X-Requested-With refused', noHeader.status === 403, noHeader.status);
  const formPost = await fetch(B + '/api/savings', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: a.cookie() }, body: 'type=withdraw&amount=1000&date=' + today });
  check('CSRF: HTML form post refused', formPost.status === 403, formPost.status);

  // ---- 6. Injection and bad input
  r = await a('GET', `/api/loans/1%20OR%201=1`); check('SQL-looking id rejected', r.status === 404, r.status);
  r = await a('DELETE', `/api/savings/1;DROP TABLE users`); check('SQL injection in path harmless', r.status === 404, r.status);
  r = await a('POST', '/api/auth/login', { username: "' OR '1'='1", password: "' OR '1'='1" }); check('SQL injection in login fails', r.status === 401, r.status);
  r = await a('POST', '/api/savings', { type: 'deposit', amount: -500, date: today }); check('negative amount refused', r.status === 400);
  r = await a('POST', '/api/savings', { type: 'deposit', amount: 'NaN', date: today }); check('NaN amount refused', r.status === 400);
  r = await a('POST', '/api/savings', { type: 'withdraw', amount: 1e9, date: today }); check('withdraw beyond balance refused', r.status === 400);
  r = await a('POST', '/api/loans', { direction: 'lent', person: 'x'.repeat(500), amount: 1, date: today }); check('over-long name refused', r.status === 400);
  r = await a('POST', '/api/loans', { direction: 'lent', person: 'x', amount: 1, date: '2099-01-01' }); check('future-dated loan refused', r.status === 400);
  r = await a('POST', '/api/loans', { direction: 'lent', person: 'x', amount: 1, date: '2020-01-01' }); check('past-dated loan needs password', r.body?.error === 'PAST_DAY_LOCKED', r.body?.error);
  r = await a('POST', '/api/savings', '{"type":"deposit","__proto__":{"admin":true},"amount":1,"date":"' + today + '"}');
  const r2 = await a('GET', '/api/auth/me'); check('prototype pollution ignored', r2.body.user.role === 'user');
  r = await a('POST', '/api/entries', 'x'.repeat(30000)); check('oversized body refused', r.status === 413 || r.status === 400, r.status);
  r = await a('POST', '/api/entries', '{bad json'); check('malformed JSON handled', r.status === 400, r.status);
  for (const p of ['/../server/config.js', '/%2e%2e/%2e%2e/etc/passwd', '/.env', '/package.json', '/server/app.js', '/.git/config', '/data/pgdata']) {
    const res = await fetch(B + p); const t = await res.text();
    check(`no file leak at ${p}`, res.status === 404 || !/APP_SECRET|root:|"dependencies"|\[core\]|require\(/.test(t), res.status);
  }

  // ---- 7. Brute force protection
  const brute = client(); let locked = false;
  for (let i = 0; i < 8; i++) { r = await brute('POST', '/api/auth/login', { username: 'bobsec', password: 'wrong' + i }); if (r.body?.error === 'ACCOUNT_LOCKED' || r.status === 429) locked = true; }
  check('repeated wrong passwords lock the account', locked);
  r = await brute('POST', '/api/auth/login', { username: 'nobody-here', password: 'x' }); const r3 = await brute('POST', '/api/auth/login', { username: 'alicesec', password: 'wrongpass1' });
  check('login does not reveal which usernames exist', r.body?.error === r3.body?.error, `${r.body?.error} vs ${r3.body?.error}`);

  // ---- 8. Sessions
  r = await a('POST', '/api/auth/logout', {}); const old = a.cookie();
  const replay = await fetch(B + '/api/auth/me', { headers: { Cookie: old, 'X-Requested-With': 'FinanceBaba' } });
  check('session cookie dead after logout', replay.status === 401, replay.status);
  const forged = await fetch(B + '/api/auth/me', { headers: { Cookie: 'fb_session=' + 'A'.repeat(43) } });
  check('forged session cookie rejected', forged.status === 401, forged.status);

  // ---- 9. Android / PWA
  r = await anon('GET', '/.well-known/assetlinks.json');
  check('assetlinks lists only our app', r.body?.length === 1 && r.body[0].target.package_name === 'com.financebaba.app');
  const sw = await (await fetch(B + '/sw.js')).text();
  check('service worker never caches /api', /pathname\.startsWith\('\/api\/'\)\) return|startsWith\('\/api\/'\)/.test(sw));
  const apiHit = await fetch(B + '/api/auth/me'); check('API marked no-store', /no-store/.test(apiHit.headers.get('cache-control') || ''));

  const failed = results.filter((x) => !x.ok).map((x) => `${x.name} (${x.detail})`);
  assert.ok(results.length > 90, 'all checks ran');
  assert.deepEqual(failed, []);
});
