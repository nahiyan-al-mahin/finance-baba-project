'use strict';
/*
 * Postgres access.
 * - Production (Vercel, or anywhere DATABASE_URL is set): Neon Postgres through `pg`.
 * - Local development and tests without DATABASE_URL: PGlite, a real Postgres engine running
 *   inside Node that stores its files in DATA_DIR/pgdata. Same SQL, nothing to install.
 *
 * Only dates and timestamps are stored in plain text (needed for range queries).
 * Amounts, categories, notes and names are all inside the *_enc columns.
 */
const path = require('path');
const { DATABASE_URL, dataDir } = require('./config');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id                   SERIAL PRIMARY KEY,
  public_id            TEXT UNIQUE NOT NULL,
  username_idx         TEXT UNIQUE NOT NULL,
  role                 TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  auth_salt            TEXT NOT NULL,
  auth_hash            TEXT NOT NULL,
  wrapped_dek          TEXT NOT NULL,
  recovery_salt        TEXT NOT NULL,
  recovery_wrapped_dek TEXT NOT NULL,
  google_idx           TEXT UNIQUE,
  google_wrapped_dek   TEXT,
  profile_enc          TEXT NOT NULL,
  timezone             TEXT NOT NULL,
  onboarded            INTEGER NOT NULL DEFAULT 0,
  failed_logins        INTEGER NOT NULL DEFAULT 0,
  total_failed_logins  INTEGER NOT NULL DEFAULT 0,
  locked_until         BIGINT,
  past_edits           INTEGER NOT NULL DEFAULT 0,
  created_at           BIGINT NOT NULL,
  last_active_at       BIGINT
);

CREATE TABLE IF NOT EXISTS entries (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date TEXT NOT NULL,
  data_enc   TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_user_date ON entries(user_id, entry_date);

CREATE TABLE IF NOT EXISTS warnings (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_enc     TEXT NOT NULL,
  created_at      BIGINT NOT NULL,
  acknowledged_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_warnings_user ON warnings(user_id);

-- Login sessions. The user's data key is stored encrypted with a key derived from the
-- session token, which exists only in the browser cookie (see sessions.js).
CREATE TABLE IF NOT EXISTS sessions (
  id_hash        TEXT PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role           TEXT NOT NULL,
  dek_enc        TEXT NOT NULL,
  created_at     BIGINT NOT NULL,
  last_seen      BIGINT NOT NULL,
  unlocked_until BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- First-time Google sign-ins waiting for the user to pick a username + password.
CREATE TABLE IF NOT EXISTS google_pending (
  token_hash TEXT PRIMARY KEY,
  data_enc   TEXT NOT NULL,
  expires_at BIGINT NOT NULL
);

-- Monthly spending target (amount encrypted with the user's key). One row per user per month.
CREATE TABLE IF NOT EXISTS targets (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month      TEXT NOT NULL,
  data_enc   TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, month)
);

-- Email verification codes (one pending address per user).
CREATE TABLE IF NOT EXISTS email_codes (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  email_enc  TEXT NOT NULL,
  email_idx  TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  expires_at BIGINT NOT NULL
);

-- Counters for rate limiting (shared by all server instances).
CREATE TABLE IF NOT EXISTS rate_limits (
  key      TEXT PRIMARY KEY,
  hits     INTEGER NOT NULL,
  reset_at BIGINT NOT NULL
);

-- Loans (borrowed / lent). Everything about a loan is in data_enc, encrypted with the user's key.
CREATE TABLE IF NOT EXISTS loans (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data_enc   TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_loans_user ON loans(user_id);

-- Savings log (money put in / taken out). Amount, type and note are encrypted.
CREATE TABLE IF NOT EXISTS savings (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date TEXT NOT NULL,
  data_enc   TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_savings_user_date ON savings(user_id, entry_date);

-- Days marked "no income or expense" (keeps the logging streak going).
CREATE TABLE IF NOT EXISTS quiet_days (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, day)
);

-- Cached exchange rates (one row).
CREATE TABLE IF NOT EXISTS fx_rates (
  id         INTEGER PRIMARY KEY,
  data       TEXT NOT NULL,
  fetched_at BIGINT NOT NULL
);

-- Columns added after the first release (safe to run on an existing database).
-- email_enc is encrypted with the server key so monthly reports can be sent while the user is offline;
-- report_dek is the user's data key wrapped with the server key, present only while monthly email reports are on.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_idx TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_enc TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lang TEXT NOT NULL DEFAULT 'en';
ALTER TABLE users ADD COLUMN IF NOT EXISTS report_dek TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_report_month TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reports_opt_out INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email_idx);
`;

const INT8 = 20; // Postgres BIGINT / COUNT(*) — our values are millisecond timestamps and counts, safe as JS numbers

function createClient() {
  if (DATABASE_URL) {
    const { Pool, types } = require('pg');
    types.setTypeParser(INT8, (v) => (v === null ? null : Number(v)));
    // Small pool: on Vercel every function instance has its own. Use Neon's *pooled* connection string.
    const pool = new Pool({ connectionString: DATABASE_URL, max: 3, idleTimeoutMillis: 10000 });
    return { query: (sql, params) => pool.query(sql, params), exec: (sql) => pool.query(sql), end: () => pool.end() };
  }
  const { PGlite } = require('@electric-sql/pglite');
  const pg = new PGlite(path.join(dataDir(), 'pgdata'), { parsers: { [INT8]: (v) => Number(v) } });
  return { query: (sql, params) => pg.query(sql, params), exec: (sql) => pg.exec(sql), end: () => pg.close() };
}

const client = createClient();
const ready = client.exec(SCHEMA);

/** Runs a query and returns all rows. Uses $1, $2... placeholders. */
async function all(sql, params = []) {
  await ready;
  return (await client.query(sql, params)).rows;
}

/** Runs a query and returns the first row (or undefined). */
async function one(sql, params = []) {
  return (await all(sql, params))[0];
}

/** Runs a statement and returns the number of affected rows. */
async function run(sql, params = []) {
  await ready;
  const res = await client.query(sql, params);
  return res.rowCount ?? res.affectedRows ?? 0;
}

const isUniqueViolation = (err) => err && err.code === '23505';

module.exports = { ready, all, one, run, close: () => client.end(), isUniqueViolation };
