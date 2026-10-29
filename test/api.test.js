'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-test-'));
process.env.DATA_DIR = tmp;
process.env.APP_SECRET = 'a'.repeat(64);
process.env.AUTH_RATE_LIMIT = '1000';
process.env.ANDROID_CERT_SHA256 = 'ab:'.repeat(31) + 'CD, not-a-fingerprint';

const { mail } = require('../server/mail');
const outbox = mail.useTestTransport();
const app = require('../server/app');
const dates = require('../server/dates');
const db = require('../server/db');
const users = require('../server/users');
const { todayIn, addDays } = require('../server/dates');
const rates = require('../server/rates');
// Fixed rates (units per USD) so tests never depend on the network.
rates.setRatesForTests({ BDT: 120, USD: 1, EUR: 0.8, SAR: 3.75 });

let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  server.close();
  await db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'FinanceBaba', ...(cookie && { Cookie: cookie }) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };
}

const today = todayIn('Asia/Dhaka');
const yesterday = addDays(today, -1);

test('full user flow: signup, entries, encryption, past-day lock, reports, recovery', async () => {
  const alice = client();
  let r = await alice('POST', '/auth/signup', { email: 'alice@example.com', username: 'Alice', displayName: 'Alice Rahman', password: 'secret123', timezone: 'Asia/Dhaka' });
  assert.equal(r.status, 201);
  assert.match(r.body.recoveryCode, /^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/);
  const recoveryCode = r.body.recoveryCode;

  r = await alice('POST', '/entries', { date: today, type: 'expense', amount: 250.5, category: 'food', note: 'বিরিয়ানি lunch' });
  assert.equal(r.status, 201);
  await alice('POST', '/entries', { date: today, type: 'income', amount: 1000, category: 'salary', note: 'Advance' });
  r = await alice('GET', '/entries');
  assert.deepEqual([r.body.totals.expense, r.body.totals.income, r.body.totals.net], [250.5, 1000, 749.5]);

  // Nothing readable at rest
  const raw = JSON.stringify(await db.all('SELECT * FROM entries')) + JSON.stringify(await db.all('SELECT * FROM users')) + JSON.stringify(await db.all('SELECT * FROM sessions'));
  for (const secret of ['বিরিয়ানি', 'lunch', '250.5', 'Alice', 'alice', 'secret123', 'example.com']) assert.ok(!raw.includes(secret), `"${secret}" leaked`);

  // Past days need the password
  r = await alice('POST', '/entries', { date: yesterday, type: 'expense', amount: 10, category: 'transport', note: 'Rickshaw' });
  assert.equal(r.body.error, 'PAST_DAY_LOCKED');
  r = await alice('POST', '/auth/unlock', { password: 'wrong-pass1' });
  assert.equal(r.status, 401);
  r = await alice('POST', '/auth/unlock', { password: 'secret123' });
  assert.equal(r.status, 200);
  r = await alice('POST', '/entries', { date: yesterday, type: 'expense', amount: 10, category: 'transport', note: 'Rickshaw' });
  assert.equal(r.status, 201);
  r = await alice('POST', '/entries', { date: addDays(today, 1), type: 'expense', amount: 10, category: 'transport', note: 'x' });
  assert.equal(r.body.error, 'FUTURE_DATE');

  for (const period of ['week', 'month', 'year']) {
    r = await alice('GET', `/reports/summary?period=${period}`);
    assert.equal(r.status, 200);
    assert.ok(r.body.totals.expense >= 250.5);
  }
  for (const [period, lang] of [['week', 'en'], ['month', 'bn'], ['year', 'en']]) {
    r = await alice('GET', `/reports/pdf?period=${period}&lang=${lang}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.subarray(0, 4).toString(), '%PDF');
  }

  // Bob cannot see Alice's data
  const bob = client();
  await bob('POST', '/auth/signup', { email: 'bob@example.com', username: 'bob', displayName: 'Bob', password: 'secret456', timezone: 'Asia/Dhaka' });
  r = await bob('GET', '/entries');
  assert.equal(r.body.entries.length, 0);
  const aliceEntry = (await db.one('SELECT id FROM entries ORDER BY id LIMIT 1')).id;
  r = await bob('DELETE', `/entries/${aliceEntry}`);
  assert.equal(r.status, 404);

  // Forgot password keeps data
  const fresh = client();
  r = await fresh('POST', '/auth/recover', { username: 'alice', recoveryCode: recoveryCode.toLowerCase(), newPassword: 'newpass789' });
  assert.equal(r.status, 200);
  assert.notEqual(r.body.recoveryCode, recoveryCode);
  r = await fresh('GET', '/entries');
  assert.equal(r.body.entries.length, 2);
  r = await client()('POST', '/auth/login', { username: 'alice', password: 'secret123' });
  assert.equal(r.status, 401);
});

test('admin sees counts only and can warn users', async () => {
  await users.createUser({ username: 'boss', displayName: 'Boss', password: 'admin1234', timezone: 'Asia/Dhaka', role: 'admin' });
  const admin = client();
  let r = await admin('POST', '/auth/login', { username: 'boss', password: 'admin1234' });
  assert.equal(r.body.user.role, 'admin');
  r = await admin('GET', '/admin/stats');
  assert.equal(r.body.totalUsers, 2);
  r = await admin('GET', '/admin/users');
  assert.ok(!JSON.stringify(r.body).match(/alice|bob|Rickshaw/i));
  r = await admin('GET', '/entries');
  assert.equal(r.status, 403);

  const target = r && (await admin('GET', '/admin/users')).body.users[0].id;
  r = await admin('POST', `/admin/users/${target}/warnings`, { message: 'Please stop spamming entries.' });
  assert.equal(r.status, 201);
});

test('requests without the CSRF header are rejected and lockout works', async () => {
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
  const c = client();
  await c('POST', '/auth/signup', { email: 'carol@example.com', username: 'carol', displayName: 'Carol', password: 'carol1234' });
  for (let i = 0; i < 5; i++) await client()('POST', '/auth/login', { username: 'carol', password: 'nope12345' });
  const r = await client()('POST', '/auth/login', { username: 'carol', password: 'carol1234' });
  assert.equal(r.body.error, 'ACCOUNT_LOCKED');
});

test('Google sign-in: first-time signup, returning login, linking, unlinking', async () => {
  const { google } = require('../server/google');
  google.enabled = () => true;
  google.verify = async (credential) => {
    if (!credential.startsWith('sub-')) throw new (require('../server/errors').AppError)(401, 'GOOGLE_INVALID');
    return { sub: credential, email: `${credential}@gmail.com`, name: 'Karim Ali' };
  };

  const c1 = client();
  let r = await c1('POST', '/auth/google', { credential: 'bogus' });
  assert.equal(r.body.error, 'GOOGLE_INVALID');
  r = await c1('POST', '/auth/google', { credential: 'sub-karim' });
  assert.equal(r.body.needsSignup, true);
  assert.equal(r.body.username, 'subkarim');
  const signupToken = r.body.signupToken;
  r = await c1('POST', '/auth/google/signup', { signupToken, username: 'karim', displayName: 'Karim', password: 'short' });
  assert.equal(r.body.error, 'WEAK_PASSWORD'); // token survives a validation error
  r = await c1('POST', '/auth/google/signup', { signupToken, username: 'karim', displayName: 'Karim', password: 'karim1234' });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.googleEmail, 'sub-karim@gmail.com');
  await c1('POST', '/entries', { date: today, type: 'expense', amount: 99, category: 'food', note: 'Fuchka' });
  r = await c1('POST', '/auth/google/signup', { signupToken, username: 'karim2', displayName: 'K', password: 'karim1234' });
  assert.equal(r.body.error, 'GOOGLE_EXPIRED'); // single use
  assert.ok(!JSON.stringify(await db.all('SELECT * FROM users')).includes('sub-karim'));
  assert.ok(!JSON.stringify(await db.all('SELECT * FROM google_pending')).includes('karim'));

  // Returning user: Google alone unlocks the encrypted data
  const c2 = client();
  r = await c2('POST', '/auth/google', { credential: 'sub-karim' });
  assert.equal(r.body.user.displayName, 'Karim');
  r = await c2('GET', '/entries');
  assert.equal(r.body.entries[0].note, 'Fuchka');
  // ...and the password still works too
  r = await client()('POST', '/auth/login', { username: 'karim', password: 'karim1234' });
  assert.equal(r.status, 200);

  // Existing password account links a Google account; one Google account cannot be linked twice
  const dina = client();
  await dina('POST', '/auth/signup', { email: 'dina@example.com', username: 'dina', displayName: 'Dina', password: 'dina12345' });
  r = await dina('POST', '/auth/google/link', { credential: 'sub-karim' });
  assert.equal(r.body.error, 'GOOGLE_IN_USE');
  r = await dina('POST', '/auth/google/link', { credential: 'sub-dina' });
  assert.equal(r.body.user.googleEmail, 'sub-dina@gmail.com');
  r = await client()('POST', '/auth/google', { credential: 'sub-dina' });
  assert.equal(r.body.user.displayName, 'Dina');

  r = await dina('POST', '/auth/google/unlink', { password: 'wrong1234' });
  assert.equal(r.status, 401);
  r = await dina('POST', '/auth/google/unlink', { password: 'dina12345' });
  assert.equal(r.body.user.googleEmail, null);
  r = await client()('POST', '/auth/google', { credential: 'sub-dina' });
  assert.equal(r.body.needsSignup, true);
});

test('sessions live in the database and only the cookie can unlock them', async () => {
  const dave = client();
  let r = await dave('POST', '/auth/signup', { email: 'dave@example.com', username: 'dave', displayName: 'Dave', password: 'dave12345' });
  assert.equal(r.status, 201);
  const rows = await db.all("SELECT s.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.public_id = $1", [r.body.user.id]);
  assert.equal(rows.length, 1);
  assert.match(rows[0].id_hash, /^[0-9a-f]{64}$/); // only a hash of the cookie token is stored

  // Past-day unlock is remembered across requests (stored on the session row)
  await dave('POST', '/auth/unlock', { password: 'dave12345' });
  r = await dave('POST', '/entries', { date: yesterday, type: 'expense', amount: 5, category: 'food', note: 'Tea' });
  assert.equal(r.status, 201);

  // Removing the row logs the user out immediately
  await db.run('DELETE FROM sessions WHERE id_hash = $1', [rows[0].id_hash]);
  r = await dave('GET', '/entries');
  assert.equal(r.status, 401);

  // Login attempts are counted in the shared rate-limit table
  assert.ok((await db.all("SELECT * FROM rate_limits WHERE key LIKE 'auth:%'")).length > 0);
  r = await dave('DELETE', '/entries/not-a-number');
  assert.equal(r.status, 401);
});

const codeFrom = (to) => {
  const msg = [...outbox].reverse().find((m) => m.to === to && /\b\d{6}\b/.test(m.text));
  return msg && msg.text.match(/\b(\d{6})\b/)[1];
};

test('email: sign-up sends a code, verifying it enables login by email', async () => {
  const eve = client();
  let r = await eve('POST', '/auth/signup', { username: 'eve', displayName: 'Eve', password: 'eve123456', email: 'Eve@Example.com' });
  assert.equal(r.status, 201);
  assert.equal(r.body.pendingEmail, 'eve@example.com');
  assert.equal(r.body.user.emailVerified, false);
  assert.equal(r.body.user.reportsEnabled, true); // monthly reports on by default

  r = await eve('POST', '/account/email/verify', { code: '000000' === codeFrom('eve@example.com') ? '111111' : '000000' });
  assert.equal(r.body.error, 'INVALID_CODE');
  r = await eve('POST', '/account/email/verify', { code: codeFrom('eve@example.com') });
  assert.equal(r.body.user.emailVerified, true);
  assert.equal(r.body.user.email, 'eve@example.com');

  r = await client()('POST', '/auth/login', { username: 'EVE@example.com', password: 'eve123456' });
  assert.equal(r.status, 200);
  r = await client()('POST', '/auth/signup', { username: 'eve2', displayName: 'Eve 2', password: 'eve123456', email: 'eve@example.com' });
  assert.equal(r.body.error, 'EMAIL_TAKEN');
  r = await client()('POST', '/auth/signup', { username: 'noemail', displayName: 'X', password: 'eve123456' });
  assert.equal(r.body.error, 'INVALID_EMAIL');

  // Reports can be switched off (the server-held key copy is deleted)
  r = await eve('PUT', '/account/reports', { enabled: false });
  assert.equal(r.body.user.reportsEnabled, false);
  assert.equal((await db.one("SELECT report_dek FROM users WHERE public_id = $1", [r.body.user.id])).report_dek, null);
  r = await eve('PUT', '/account/reports', { enabled: true });
  assert.equal(r.body.user.reportsEnabled, true);
});

test('monthly target: only on days 1-3, over-target alert and email once', async () => {
  const frank = client();
  const at = (iso) => dates.setClock(() => Date.parse(iso));
  try {
    at('2026-11-02T06:00:00Z'); // 2 Nov in Dhaka
    await frank('POST', '/auth/signup', { username: 'frank', displayName: 'Frank', password: 'frank1234', email: 'frank@example.com' });
    await frank('POST', '/account/email/verify', { code: codeFrom('frank@example.com') });

    let r = await frank('PUT', '/account/target', { amount: 1000 });
    assert.deepEqual([r.body.amount, r.body.canEdit, r.body.over], [1000, true, false]);

    r = await frank('POST', '/entries', { date: '2026-11-02', type: 'expense', amount: 600, category: 'food', note: 'Groceries' });
    assert.equal(r.body.target.newlyOver, false);
    const before = outbox.length;
    r = await frank('POST', '/entries', { date: '2026-11-02', type: 'expense', amount: 500, category: 'rent', note: 'Rent part' });
    assert.equal(r.body.target.newlyOver, true);
    assert.equal(r.body.target.over, true);
    assert.equal(outbox.length, before + 1);
    assert.match(outbox.at(-1).subject, /over your monthly target/);
    r = await frank('POST', '/entries', { date: '2026-11-02', type: 'expense', amount: 10, category: 'food', note: 'Tea' });
    assert.equal(r.body.target.newlyOver, false); // only the first time
    assert.equal(outbox.length, before + 1);

    at('2026-11-04T06:00:00Z'); // day 4: locked
    r = await frank('PUT', '/account/target', { amount: 5000 });
    assert.equal(r.body.error, 'TARGET_LOCKED');
    r = await frank('GET', '/account/target');
    assert.deepEqual([r.body.amount, r.body.canEdit, r.body.spent], [1000, false, 1110]);

    // Month end: the report for November is emailed once, with the PDF attached
    at('2026-12-01T06:00:00Z');
    const { runMonthlyReports } = require('../server/monthlyReports');
    const first = await runMonthlyReports();
    assert.equal(first.failed, 0);
    const report = outbox.find((m) => m.to === 'frank@example.com' && m.attachments);
    assert.ok(report, 'report email sent');
    assert.equal(report.attachments[0].content.subarray(0, 4).toString(), '%PDF');
    const count = outbox.filter((m) => m.attachments).length;
    await runMonthlyReports();
    assert.equal(outbox.filter((m) => m.attachments).length, count); // not sent twice
  } finally {
    dates.setClock(null);
  }
});

test('currency: Taka by default, change is dated, old entries converted, reports still work', async () => {
  const dina = client();
  await dina('POST', '/auth/signup', { email: 'dina.currency@example.com', username: 'dinacur', displayName: 'Dina', password: 'dina12345', timezone: 'Asia/Dhaka' });
  let r = await dina('GET', '/auth/me');
  assert.equal(r.body.user.currency, 'BDT');
  assert.deepEqual(r.body.user.currencyHistory, []);
  await dina('POST', '/entries', { date: today, type: 'expense', amount: 1200, category: 'food', note: 'Before the move' });

  r = await dina('PUT', '/account/currency', { currency: 'XYZ' });
  assert.equal(r.body.error, 'INVALID_CURRENCY');
  r = await dina('PUT', '/account/currency', { currency: 'usd' });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.currency, 'USD');
  assert.deepEqual(r.body.user.currencyHistory, [{ date: today, from: 'BDT', to: 'USD' }]);

  // New entries are in dollars; the old Taka entry is converted for totals and keeps its original amount.
  await dina('POST', '/entries', { date: today, type: 'expense', amount: 5, category: 'food', note: 'Coffee' });
  r = await dina('GET', '/entries');
  assert.equal(r.body.currency, 'USD');
  const old = r.body.entries.find((e) => e.note === 'Before the move');
  assert.deepEqual([old.amount, old.originalAmount, old.currency, old.converted], [10, 1200, 'BDT', true]);
  assert.equal(r.body.entries.find((e) => e.note === 'Coffee').currency, 'USD');
  assert.equal(r.body.totals.expense, 15);

  // Editing the old entry keeps it in Taka.
  r = await dina('PUT', `/entries/${old.id}`, { date: today, type: 'expense', amount: 2400, category: 'food', note: 'Before the move' });
  assert.equal(r.status, 200);
  r = await dina('GET', '/entries');
  assert.equal(r.body.totals.expense, 25);

  r = await dina('GET', '/reports/summary?period=month');
  assert.equal(r.body.currency, 'USD');
  assert.equal(r.body.currencyChanges.length, 1);
  r = await dina('GET', '/reports/pdf?period=month&lang=en');
  assert.equal(r.body.subarray(0, 4).toString(), '%PDF');
  r = await dina('GET', '/reports/pdf?period=year&lang=bn');
  assert.equal(r.body.subarray(0, 4).toString(), '%PDF');

  // Live rates for the "In Taka" page
  r = await dina('GET', '/account/fx');
  assert.equal(r.body.bdtPer.USD, 120);
  assert.equal(r.body.bdtPer.BDT, 1);

  // Changing back the same day leaves no history line
  r = await dina('PUT', '/account/currency', { currency: 'BDT' });
  assert.deepEqual(r.body.user.currencyHistory, []);
  r = await dina('GET', '/entries');
  assert.equal(r.body.totals.expense, 3000); // 2400 Taka + 5 dollars
});

test('loans stay open until repaid; savings log and balance', async () => {
  const eva = client();
  await eva('POST', '/auth/signup', { email: 'eva@example.com', username: 'evaloan', displayName: 'Eva', password: 'eva123456', timezone: 'Asia/Dhaka' });

  // Lend 5000 to Rafi, borrow 2000 from Sumi
  let r = await eva('POST', '/loans', { direction: 'lent', person: 'Rafi', amount: 5000, date: today, dueDate: addDays(today, 30), note: 'For his exam fee' });
  assert.equal(r.status, 201);
  const rafi = r.body.loan;
  assert.deepEqual([rafi.open, rafi.remaining, rafi.currency], [true, 5000, 'BDT']);
  r = await eva('POST', '/loans', { direction: 'borrowed', person: 'Sumi', amount: 2000, date: today });
  const sumi = r.body.loan;
  r = await eva('POST', '/loans', { direction: 'borrowed', person: 'X', amount: 10, date: yesterday });
  assert.equal(r.body.error, 'PAST_DAY_LOCKED');
  r = await eva('POST', '/loans', { direction: 'sideways', person: 'X', amount: 10, date: today });
  assert.equal(r.body.error, 'INVALID_DIRECTION');

  r = await eva('GET', '/loans');
  assert.deepEqual(r.body.totals, { owe: 2000, owed: 5000, open: 2 });

  // Partial repayment keeps it open; too much is refused; the rest closes it.
  r = await eva('POST', `/loans/${rafi.id}/payments`, { amount: 2000, date: today });
  assert.deepEqual([r.body.loan.open, r.body.loan.remaining], [true, 3000]);
  r = await eva('POST', `/loans/${rafi.id}/payments`, { amount: 4000, date: today });
  assert.equal(r.body.error, 'PAYMENT_TOO_BIG');
  r = await eva('POST', `/loans/${rafi.id}/payments`, { full: true, date: today });
  assert.deepEqual([r.body.loan.open, r.body.loan.remaining, r.body.loan.settledAt], [false, 0, today]);
  r = await eva('POST', `/loans/${rafi.id}/payments`, { amount: 1, date: today });
  assert.equal(r.body.error, 'LOAN_SETTLED');

  // Undoing a repayment re-opens the loan
  const last = r && (await eva('GET', '/loans')).body.loans.find((l) => l.id === rafi.id).payments.at(-1);
  r = await eva('DELETE', `/loans/${rafi.id}/payments/${last.id}`);
  assert.deepEqual([r.body.loan.open, r.body.loan.remaining], [true, 3000]);

  r = await eva('GET', '/loans');
  assert.deepEqual(r.body.totals, { owe: 2000, owed: 3000, open: 2 });

  // Editing: the amount can't drop below what was repaid
  r = await eva('PUT', `/loans/${rafi.id}`, { person: 'Rafi bhai', amount: 1000, date: today });
  assert.equal(r.body.error, 'LOAN_BELOW_PAID');
  r = await eva('PUT', `/loans/${rafi.id}`, { person: 'Rafi bhai', amount: 6000, date: today, note: 'Exam + books' });
  assert.deepEqual([r.body.loan.person, r.body.loan.remaining, r.body.loan.direction], ['Rafi bhai', 4000, 'lent']);
  r = await eva('PUT', `/loans/${rafi.id}`, { person: 'Rafi', amount: 5000, date: today });
  r = await eva('GET', '/loans');
  assert.equal(r.body.loans[0].open, true);

  // Loans are encrypted, and other users can't touch them
  const raw = JSON.stringify(await db.all('SELECT * FROM loans'));
  assert.ok(!raw.includes('Rafi') && !raw.includes('exam'));
  r = await client()('DELETE', `/loans/${sumi.id}`);
  assert.equal(r.status, 401);

  // Savings
  r = await eva('POST', '/savings', { type: 'deposit', amount: 1500, date: today, note: 'Salary leftovers' });
  assert.equal(r.status, 201);
  r = await eva('POST', '/savings', { type: 'withdraw', amount: 2000, date: today });
  assert.equal(r.body.error, 'NOT_ENOUGH_SAVINGS');
  r = await eva('POST', '/savings', { type: 'withdraw', amount: 500, date: today, note: 'Doctor' });
  assert.equal(r.body.summary.balance, 1000);
  assert.deepEqual([r.body.summary.month.added, r.body.summary.month.withdrawn, r.body.summary.month.net], [1500, 500, 1000]);
  assert.equal(r.body.summary.months.length, 6);
  assert.equal(r.body.summary.savedMonths, 1);
  r = await eva('GET', '/savings');
  assert.equal(r.body.logs.length, 2);
  r = await eva('DELETE', `/savings/${r.body.logs[0].id}`);
  assert.equal(r.body.summary.balance, 1500);
  assert.ok(!JSON.stringify(await db.all('SELECT * FROM savings')).includes('leftovers'));

  // Both show up in the reports
  r = await eva('GET', '/reports/summary?period=month');
  assert.equal(r.body.savings.balance, 1500);
  assert.deepEqual([r.body.loans.owe, r.body.loans.owed], [2000, 3000]);
  r = await eva('GET', '/reports/pdf?period=month&lang=bn');
  assert.equal(r.body.subarray(0, 4).toString(), '%PDF');

  r = await eva('DELETE', `/loans/${sumi.id}`);
  assert.equal(r.status, 200);
  r = await eva('GET', '/loans');
  assert.equal(r.body.totals.owe, 0);
});

test('Android: assetlinks.json names the app and its signing key', async () => {
  const res = await fetch(base.replace(/\/api$/, '') + '/.well-known/assetlinks.json');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body[0].target.package_name, 'com.financebaba.app');
  assert.deepEqual(body[0].target.sha256_cert_fingerprints, ['AB:'.repeat(31) + 'CD']);
  for (const file of ['/manifest.webmanifest', '/sw.js', '/offline.html', '/img/app/maskable-512.png']) {
    assert.equal((await fetch(base.replace(/\/api$/, '') + file)).status, 200, file);
  }
});

test('cron endpoint requires the secret', async () => {
  const res = await fetch(`${base}/cron/monthly-reports`);
  assert.equal(res.status, 401);
});
