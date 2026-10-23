'use strict';
const db = require('./db');
const users = require('./users');
const { DEFAULT_TZ } = require('./config');

/**
 * On hosts without a terminal (Vercel), set ADMIN_USERNAME + ADMIN_PASSWORD once: the admin
 * account is created on start-up if it does not exist yet. Remove ADMIN_PASSWORD afterwards.
 */
async function ensureAdminFromEnv() {
  await db.ready;
  const { ADMIN_USERNAME, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) return;
  try {
    if (await users.findByUsername(ADMIN_USERNAME)) return;
    await users.createUser({ username: ADMIN_USERNAME, displayName: 'Admin', password: ADMIN_PASSWORD, timezone: DEFAULT_TZ, role: 'admin' });
    console.log(`[finance-baba] Admin "${users.normalizeUsername(ADMIN_USERNAME)}" created. You can now remove ADMIN_PASSWORD.`);
  } catch (err) {
    console.error(`[finance-baba] Could not create admin from env: ${err.code || err.message}`);
  }
}

module.exports = { ensureAdminFromEnv };
