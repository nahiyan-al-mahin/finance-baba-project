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
const googleAad = (row) => `google:${row.public_id}`;
const googleIndex = (sub) => c.blindIndex(`google:${sub}`);
const reportAad = (row) => `report:${row.public_id}`;

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
const emailIndex = (e) => c.blindIndex(`email:${normalizeEmail(e)}`);
const emailAad = (row) => `email:${row.public_id}`;

function validateEmail(email) {
  const e = normalizeEmail(email);
  if (!EMAIL_RE.test(e) || e.length > 254) throw new AppError(400, 'INVALID_EMAIL');
  return e;
}

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

async function newPublicId() {
  for (;;) {
    const id = `FB-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    if (!(await db.one('SELECT 1 FROM users WHERE public_id = $1', [id]))) return id;
  }
}

const findById = (id) => db.one('SELECT * FROM users WHERE id = $1', [id]);
const findByUsername = (u) => db.one('SELECT * FROM users WHERE username_idx = $1', [usernameIndex(u)]);
const findByEmail = (e) => db.one('SELECT * FROM users WHERE email_idx = $1 AND email_verified = 1', [emailIndex(e)]);
/** Login accepts a username or a verified email address. */
const findByLogin = (id) => (String(id || '').includes('@') ? findByEmail(id) : findByUsername(id));

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

/**
 * Creates an account. `verifiedEmail` is only passed when the address is already proven (Google sign-in);
 * otherwise the email is confirmed separately with a code (see account.js).
 */
async function createUser({ username, displayName, password, timezone, role = 'user', verifiedEmail = null, lang = 'en' }) {
  validateUsername(username);
  validatePassword(password);
  const name = validateDisplayName(displayName);
  if (await findByUsername(username)) throw new AppError(409, 'USERNAME_TAKEN');

  const row = { public_id: await newPublicId() };
  const dek = c.newKey();
  const pw = await wrapForPassword(row, dek, password);
  const rec = await wrapForRecovery(row, dek);
  try {
    const user = await db.one(
      `INSERT INTO users (public_id, username_idx, role, auth_salt, auth_hash, wrapped_dek, recovery_salt,
         recovery_wrapped_dek, profile_enc, timezone, created_at, last_active_at,
         email_idx, email_enc, email_verified, lang, report_dek)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *`,
      [
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
        Date.now(),
        verifiedEmail ? emailIndex(verifiedEmail) : null,
        verifiedEmail ? c.serverEncrypt(normalizeEmail(verifiedEmail), emailAad(row)) : null,
        verifiedEmail ? 1 : 0,
        lang === 'bn' ? 'bn' : 'en',
        // Monthly email reports are on by default for normal users (see crypto.js); admins don't get reports.
        role === 'user' ? c.wrapForReports(dek, reportAad(row)) : null,
      ]
    );
    return { user, dek, recoveryCode: rec.code };
  } catch (err) {
    if (db.isUniqueViolation(err)) throw new AppError(409, String(err.constraint || err.detail || '').includes('email') ? 'EMAIL_TAKEN' : 'USERNAME_TAKEN');
    throw err;
  }
}

function assertNotLocked(row) {
  if (row.locked_until && row.locked_until > Date.now()) {
    throw new AppError(423, 'ACCOUNT_LOCKED', { retryAfterSec: Math.ceil((row.locked_until - Date.now()) / 1000) });
  }
}

/** Counts a wrong password; the 5th one in a row locks the account for a while. Atomic, so parallel guesses can't skip it. */
function recordFailure(row) {
  return db.run(
    `UPDATE users SET
       total_failed_logins = total_failed_logins + 1,
       locked_until  = CASE WHEN failed_logins + 1 >= $2 THEN $3 ELSE locked_until END,
       failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END
     WHERE id = $1`,
    [row.id, MAX_FAILED_LOGINS, Date.now() + LOCK_MS]
  );
}

/** Checks the password and returns the unwrapped DEK. Counts failures towards the lockout. */
async function unlockWithPassword(row, password) {
  assertNotLocked(row);
  const { authHash, kek } = await c.deriveKeys(String(password || ''), c.unb64(row.auth_salt), 'password');
  if (!c.safeEqual(authHash, c.unb64(row.auth_hash))) {
    await recordFailure(row);
    throw new AppError(401, 'INVALID_CREDENTIALS');
  }
  await db.run('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [row.id]);
  return c.decrypt(kek, row.wrapped_dek, dekAad(row));
}

async function login(username, password) {
  const row = await findByLogin(username);
  if (!row) {
    await c.deriveKeys(String(password || ''), DUMMY_SALT, 'password'); // same timing as a real check
    throw new AppError(401, 'INVALID_CREDENTIALS');
  }
  const dek = await unlockWithPassword(row, password);
  await db.run('UPDATE users SET last_active_at = $1 WHERE id = $2', [Date.now(), row.id]);
  return { user: await findById(row.id), dek };
}

async function changePassword(row, currentPassword, newPassword) {
  validatePassword(newPassword);
  const dek = await unlockWithPassword(row, currentPassword);
  const pw = await wrapForPassword(row, dek, newPassword);
  await db.run('UPDATE users SET auth_salt = $1, auth_hash = $2, wrapped_dek = $3 WHERE id = $4', [pw.auth_salt, pw.auth_hash, pw.wrapped_dek, row.id]);
}

/** Forgot password: the recovery code unwraps the DEK, so no data is lost. Issues a fresh code. */
async function recover(username, recoveryCode, newPassword) {
  validatePassword(newPassword);
  const row = await findByUsername(username);
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
    await recordFailure(row);
    throw new AppError(401, 'INVALID_RECOVERY');
  }
  const pw = await wrapForPassword(row, dek, newPassword);
  const rec = await wrapForRecovery(row, dek);
  await db.run(
    `UPDATE users SET auth_salt = $1, auth_hash = $2, wrapped_dek = $3, recovery_salt = $4, recovery_wrapped_dek = $5,
       failed_logins = 0, locked_until = NULL, last_active_at = $6 WHERE id = $7`,
    [pw.auth_salt, pw.auth_hash, pw.wrapped_dek, rec.recovery_salt, rec.recovery_wrapped_dek, Date.now(), row.id]
  );
  return { user: await findById(row.id), dek, recoveryCode: rec.code };
}

// ---- Google sign-in
const findByGoogle = (sub) => db.one('SELECT * FROM users WHERE google_idx = $1', [googleIndex(sub)]);

async function linkGoogle(row, dek, { sub, email }) {
  const other = await findByGoogle(sub);
  if (other && other.id !== row.id) throw new AppError(409, 'GOOGLE_IN_USE');
  try {
    await db.run('UPDATE users SET google_idx = $1, google_wrapped_dek = $2 WHERE id = $3', [googleIndex(sub), c.wrapForGoogle(dek, googleAad(row)), row.id]);
  } catch (err) {
    if (db.isUniqueViolation(err)) throw new AppError(409, 'GOOGLE_IN_USE');
    throw err;
  }
  await updateProfile(row, dek, { ...getProfile(row, dek), googleEmail: email });
}

async function unlinkGoogle(row, password) {
  const dek = await unlockWithPassword(row, password);
  await db.run('UPDATE users SET google_idx = NULL, google_wrapped_dek = NULL WHERE id = $1', [row.id]);
  const { googleEmail, ...profile } = getProfile(row, dek);
  await updateProfile(row, dek, profile);
}

async function loginWithGoogle(sub) {
  const row = await findByGoogle(sub);
  if (!row) return null;
  const dek = c.unwrapForGoogle(row.google_wrapped_dek, googleAad(row));
  await db.run('UPDATE users SET last_active_at = $1 WHERE id = $2', [Date.now(), row.id]);
  return { user: await findById(row.id), dek };
}

function getProfile(row, dek) {
  return c.decryptJSON(dek, row.profile_enc, profileAad(row));
}

function updateProfile(row, dek, profile) {
  return db.run('UPDATE users SET profile_enc = $1 WHERE id = $2', [c.encryptJSON(dek, profile, profileAad(row)), row.id]);
}

/** The user's verified email address, or null. Readable without their password (needed for monthly reports). */
function getEmail(row) {
  return row.email_verified && row.email_enc ? c.serverDecrypt(row.email_enc, emailAad(row)) : null;
}

/** Turns monthly email reports on (stores a server-wrapped copy of the data key) or off (deletes it). */
function setReports(row, dek, enabled) {
  return db.run('UPDATE users SET report_dek = $1, reports_opt_out = $2 WHERE id = $3', [
    enabled ? c.wrapForReports(dek, reportAad(row)) : null,
    enabled ? 0 : 1,
    row.id,
  ]);
}

/** Accounts created before monthly reports existed get them switched on at their next login (unless they opted out). */
async function ensureDefaultReports(row, dek) {
  if (row.role !== 'user' || row.report_dek || row.reports_opt_out) return;
  await db.run('UPDATE users SET report_dek = $1 WHERE id = $2 AND report_dek IS NULL AND reports_opt_out = 0', [
    c.wrapForReports(dek, reportAad(row)),
    row.id,
  ]);
}

/** Data key for building a monthly report while the user is offline, or null when reports are off. */
function reportKey(row) {
  return row.report_dek ? c.unwrapForReports(row.report_dek, reportAad(row)) : null;
}

function toPublic(row, dek) {
  const profile = getProfile(row, dek);
  return {
    id: row.public_id,
    role: row.role,
    displayName: profile.displayName,
    email: getEmail(row),
    emailVerified: !!row.email_verified,
    reportsEnabled: !!row.report_dek,
    lang: row.lang,
    googleEmail: row.google_idx ? profile.googleEmail || '' : null,
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
  linkGoogle,
  unlinkGoogle,
  loginWithGoogle,
  findByGoogle,
  findByEmail,
  validateEmail,
  normalizeEmail,
  emailIndex,
  emailAad,
  getEmail,
  setReports,
  ensureDefaultReports,
  reportKey,
};
