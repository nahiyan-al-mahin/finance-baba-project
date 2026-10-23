'use strict';
const crypto = require('crypto');
const db = require('./db');
const c = require('./crypto');
const { AppError } = require('./errors');
const { MAX_FAILED_LOGINS, LOCK_MS } = require('./config');

const USERNAME_RE = /^[a-z0-9_.]{3,30}$/;
const DUMMY_SALT = c.newSalt();

const normalizeUsername = (u) => String(u || '').trim().toLowerCase();
const usernameIndex = (u) => c.blindIndex(`username:${normalizeUsername(u)}`);
const dekAad = (row) => `dek:${row.public_id}`;
const recoveryAad = (row) => `recovery:${row.public_id}`;
const profileAad = (row) => `profile:${row.public_id}`;

function validateUsername(username) {
  if (!USERNAME_RE.test(normalizeUsername(username))) throw new AppError(400, 'INVALID_USERNAME');
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) throw new AppError(400, 'WEAK_PASSWORD');
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) throw new AppError(400, 'WEAK_PASSWORD');
}

function validateDisplayName(name) {
  const n = String(name || '').trim();
  if (n.length < 1 || n.length > 60) throw new AppError(400, 'INVALID_NAME');
  return n;
}

function newPublicId() {
  for (;;) {
    const id = `FB-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    if (!db.prepare('SELECT 1 FROM users WHERE public_id = ?').get(id)) return id;
  }
}

const findById = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
const findByUsername = (u) => db.prepare('SELECT * FROM users WHERE username_idx = ?').get(usernameIndex(u));

async function wrapForPassword(row, dek, password) {
  const salt = c.newSalt();
  const { authHash, kek } = await c.deriveKeys(password, salt, 'password');
  return { auth_salt: c.b64(salt), auth_hash: c.b64(authHash), wrapped_dek: c.encrypt(kek, dek, dekAad(row)) };
}

async function wrapForRecovery(row, dek) {
  const code = c.generateRecoveryCode();
  const salt = c.newSalt();
  const { kek } = await c.deriveKeys(c.normalizeRecoveryCode(code), salt, 'recovery');
  return { code, recovery_salt: c.b64(salt), recovery_wrapped_dek: c.encrypt(kek, dek, recoveryAad(row)) };
}

async function createUser({ username, displayName, password, timezone, role = 'user' }) {
  validateUsername(username);
  validatePassword(password);
  const name = validateDisplayName(displayName);
  if (findByUsername(username)) throw new AppError(409, 'USERNAME_TAKEN');

  const row = { public_id: newPublicId() };
  const dek = c.newKey();
  const pw = await wrapForPassword(row, dek, password);
  const rec = await wrapForRecovery(row, dek);
  try {
    const info = db
      .prepare(
        `INSERT INTO users (public_id, username_idx, role, auth_salt, auth_hash, wrapped_dek, recovery_salt,
           recovery_wrapped_dek, profile_enc, timezone, created_at, last_active_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.public_id,
        usernameIndex(username),
        role,
        pw.auth_salt,
        pw.auth_hash,
        pw.wrapped_dek,
        rec.recovery_salt,
        rec.recovery_wrapped_dek,
        c.encryptJSON(dek, { displayName: name }, profileAad(row)),
        timezone,
        Date.now(),
        Date.now()
      );
    return { user: findById(info.lastInsertRowid), dek, recoveryCode: rec.code };
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new AppError(409, 'USERNAME_TAKEN');
    throw err;
  }
}

function assertNotLocked(row) {
  if (row.locked_until && row.locked_until > Date.now()) {
    throw new AppError(423, 'ACCOUNT_LOCKED', { retryAfterSec: Math.ceil((row.locked_until - Date.now()) / 1000) });
  }
}

function recordFailure(row) {
  const failed = row.failed_logins + 1;
  if (failed >= MAX_FAILED_LOGINS) {
    db.prepare('UPDATE users SET failed_logins = 0, total_failed_logins = total_failed_logins + 1, locked_until = ? WHERE id = ?').run(
      Date.now() + LOCK_MS,
      row.id
    );
  } else {
    db.prepare('UPDATE users SET failed_logins = ?, total_failed_logins = total_failed_logins + 1 WHERE id = ?').run(failed, row.id);
  }
}

/** Checks the password and returns the unwrapped DEK. Counts failures towards the lockout. */
async function unlockWithPassword(row, password) {
  assertNotLocked(row);
  const { authHash, kek } = await c.deriveKeys(String(password || ''), c.unb64(row.auth_salt), 'password');
  if (!c.safeEqual(authHash, c.unb64(row.auth_hash))) {
    recordFailure(row);
    throw new AppError(401, 'INVALID_CREDENTIALS');
  }
  db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(row.id);
  return c.decrypt(kek, row.wrapped_dek, dekAad(row));
}

async function login(username, password) {
  const row = findByUsername(username);
  if (!row) {
    await c.deriveKeys(String(password || ''), DUMMY_SALT, 'password'); // same timing as a real check
    throw new AppError(401, 'INVALID_CREDENTIALS');
  }
  const dek = await unlockWithPassword(row, password);
  db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(Date.now(), row.id);
  return { user: findById(row.id), dek };
}

async function changePassword(row, currentPassword, newPassword) {
  validatePassword(newPassword);
  const dek = await unlockWithPassword(row, currentPassword);
  const pw = await wrapForPassword(row, dek, newPassword);
  db.prepare('UPDATE users SET auth_salt = ?, auth_hash = ?, wrapped_dek = ? WHERE id = ?').run(pw.auth_salt, pw.auth_hash, pw.wrapped_dek, row.id);
}

/** Forgot password: the recovery code unwraps the DEK, so no data is lost. Issues a fresh code. */
async function recover(username, recoveryCode, newPassword) {
  validatePassword(newPassword);
  const row = findByUsername(username);
  if (!row) {
    await c.deriveKeys('x', DUMMY_SALT, 'recovery');
    throw new AppError(401, 'INVALID_RECOVERY');
  }
  assertNotLocked(row);
  const { kek } = await c.deriveKeys(c.normalizeRecoveryCode(recoveryCode), c.unb64(row.recovery_salt), 'recovery');
  let dek;
  try {
    dek = c.decrypt(kek, row.recovery_wrapped_dek, recoveryAad(row));
  } catch {
    recordFailure(row);
    throw new AppError(401, 'INVALID_RECOVERY');
  }
  const pw = await wrapForPassword(row, dek, newPassword);
  const rec = await wrapForRecovery(row, dek);
  db.prepare(
    `UPDATE users SET auth_salt = ?, auth_hash = ?, wrapped_dek = ?, recovery_salt = ?, recovery_wrapped_dek = ?,
       failed_logins = 0, locked_until = NULL, last_active_at = ? WHERE id = ?`
  ).run(pw.auth_salt, pw.auth_hash, pw.wrapped_dek, rec.recovery_salt, rec.recovery_wrapped_dek, Date.now(), row.id);
  return { user: findById(row.id), dek, recoveryCode: rec.code };
}

function getProfile(row, dek) {
  return c.decryptJSON(dek, row.profile_enc, profileAad(row));
}

function updateProfile(row, dek, profile) {
  db.prepare('UPDATE users SET profile_enc = ? WHERE id = ?').run(c.encryptJSON(dek, profile, profileAad(row)), row.id);
}

function toPublic(row, dek) {
  return {
    id: row.public_id,
    role: row.role,
    displayName: getProfile(row, dek).displayName,
    timezone: row.timezone,
    onboarded: !!row.onboarded,
    createdAt: row.created_at,
  };
}

module.exports = {
  normalizeUsername,
  validateDisplayName,
  findById,
  findByUsername,
  createUser,
  login,
  unlockWithPassword,
  changePassword,
  recover,
  getProfile,
  updateProfile,
  toPublic,
};
