'use strict';
const Database = require('better-sqlite3');
const { DB_PATH } = require('./config');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Only dates and timestamps are stored in plain text (needed for range queries).
// Amounts, categories, notes and names are all inside the *_enc columns.
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY,
  public_id            TEXT UNIQUE NOT NULL,
  username_idx         TEXT UNIQUE NOT NULL,
  role                 TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  auth_salt            TEXT NOT NULL,
  auth_hash            TEXT NOT NULL,
  wrapped_dek          TEXT NOT NULL,
  recovery_salt        TEXT NOT NULL,
  recovery_wrapped_dek TEXT NOT NULL,
  profile_enc          TEXT NOT NULL,
  timezone             TEXT NOT NULL,
  onboarded            INTEGER NOT NULL DEFAULT 0,
  failed_logins        INTEGER NOT NULL DEFAULT 0,
  total_failed_logins  INTEGER NOT NULL DEFAULT 0,
  locked_until         INTEGER,
  past_edits           INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  last_active_at       INTEGER
);

CREATE TABLE IF NOT EXISTS entries (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date TEXT NOT NULL,
  data_enc   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_user_date ON entries(user_id, entry_date);

CREATE TABLE IF NOT EXISTS warnings (
  id              INTEGER PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_enc     TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  acknowledged_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_warnings_user ON warnings(user_id);
`);

module.exports = db;
