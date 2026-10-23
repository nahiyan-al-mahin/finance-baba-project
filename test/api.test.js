'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-test-'));
process.env.DATA_DIR = tmp;
process.env.APP_SECRET = 'a'.repeat(64);

const app = require('../server/index');
const db = require('../server/db');
const users = require('../server/users');
const { todayIn, addDays } = require('../server/dates');

let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => {
  server.close();
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
  let r = await alice('POST', '/auth/signup', { username: 'Alice', displayName: 'Alice Rahman', password: 'secret123', timezone: 'Asia/Dhaka' });
  assert.equal(r.status, 201);
  assert.match(r.body.recoveryCode, /^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/);
  const recoveryCode = r.body.recoveryCode;

  r = await alice('POST', '/entries', { date: today, type: 'expense', amount: 250.5, category: 'food', note: 'বিরিয়ানি lunch' });
  assert.equal(r.status, 201);
  await alice('POST', '/entries', { date: today, type: 'income', amount: 1000, category: 'salary', note: 'Advance' });
  r = await alice('GET', '/entries');
  assert.deepEqual([r.body.totals.expense, r.body.totals.income, r.body.totals.net], [250.5, 1000, 749.5]);

  // Nothing readable at rest
  const raw = JSON.stringify(db.prepare('SELECT * FROM entries').all()) + JSON.stringify(db.prepare('SELECT * FROM users').all());
  for (const secret of ['বিরিয়ানি', 'lunch', '250.5', 'Alice', 'alice', 'secret123']) assert.ok(!raw.includes(secret), `"${secret}" leaked`);

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
  for (const lang of ['en', 'bn']) {
    r = await alice('GET', `/reports/pdf?period=month&lang=${lang}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.subarray(0, 4).toString(), '%PDF');
  }

  // Bob cannot see Alice's data
  const bob = client();
  await bob('POST', '/auth/signup', { username: 'bob', displayName: 'Bob', password: 'secret456', timezone: 'Asia/Dhaka' });
  r = await bob('GET', '/entries');
  assert.equal(r.body.entries.length, 0);
  const aliceEntry = db.prepare('SELECT id FROM entries LIMIT 1').get().id;
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
  await c('POST', '/auth/signup', { username: 'carol', displayName: 'Carol', password: 'carol1234' });
  for (let i = 0; i < 5; i++) await client()('POST', '/auth/login', { username: 'carol', password: 'nope12345' });
  const r = await client()('POST', '/auth/login', { username: 'carol', password: 'carol1234' });
  assert.equal(r.body.error, 'ACCOUNT_LOCKED');
});
