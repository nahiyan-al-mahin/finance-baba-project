'use strict';
// Email address confirmation with a 6-digit code.
const crypto = require('crypto');
const db = require('./db');
const c = require('./crypto');
const users = require('./users');
const { mail } = require('./mail');
const emails = require('./emails');
const { AppError } = require('./errors');
const { SECRET } = require('./config');

const CODE_MS = 15 * 60 * 1000;
const RESEND_AFTER_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

const codeHash = (userId, code) => crypto.createHmac('sha256', SECRET).update(`email-code:${userId}:${code}`).digest('hex');
const pendingAad = (userId) => `email-pending:${userId}`;

/** Sends a confirmation code to `email` for this user. The address is used only once confirmed. */
async function startVerification(row, email, { name, lang }) {
  if (!mail.enabled()) throw new AppError(503, 'EMAIL_DISABLED');
  const address = users.validateEmail(email);
  const idx = users.emailIndex(address);
  const owner = await db.one('SELECT id FROM users WHERE email_idx = $1 AND email_verified = 1', [idx]);
  if (owner && owner.id !== row.id) throw new AppError(409, 'EMAIL_TAKEN');

  const existing = await db.one('SELECT expires_at FROM email_codes WHERE user_id = $1', [row.id]);
  if (existing && existing.expires_at - CODE_MS + RESEND_AFTER_MS > Date.now()) throw new AppError(429, 'EMAIL_TOO_SOON');

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await db.run(
    `INSERT INTO email_codes (user_id, code_hash, email_enc, email_idx, attempts, expires_at) VALUES ($1, $2, $3, $4, 0, $5)
     ON CONFLICT (user_id) DO UPDATE SET code_hash = $2, email_enc = $3, email_idx = $4, attempts = 0, expires_at = $5`,
    [row.id, codeHash(row.id, code), c.serverEncrypt(address, pendingAad(row.id)), idx, Date.now() + CODE_MS]
  );
  await mail.send({ to: address, ...emails.verificationCode({ lang, name, code }) });
  return address;
}

/** Confirms the code; on success the address becomes the account's email. */
async function confirm(row, code) {
  const pending = await db.one('SELECT * FROM email_codes WHERE user_id = $1', [row.id]);
  if (!pending || pending.expires_at < Date.now()) throw new AppError(400, 'CODE_EXPIRED');
  const given = Buffer.from(codeHash(row.id, String(code || '').replace(/\D/g, '')));
  if (!c.safeEqual(given, Buffer.from(pending.code_hash))) {
    if (pending.attempts + 1 >= MAX_ATTEMPTS) await db.run('DELETE FROM email_codes WHERE user_id = $1', [row.id]);
    else await db.run('UPDATE email_codes SET attempts = attempts + 1 WHERE user_id = $1', [row.id]);
    throw new AppError(400, pending.attempts + 1 >= MAX_ATTEMPTS ? 'CODE_EXPIRED' : 'INVALID_CODE');
  }
  const address = c.serverDecrypt(pending.email_enc, pendingAad(row.id));
  try {
    await db.run('UPDATE users SET email_idx = $1, email_enc = $2, email_verified = 1 WHERE id = $3', [
      pending.email_idx,
      c.serverEncrypt(address, users.emailAad(row)),
      row.id,
    ]);
  } catch (err) {
    if (db.isUniqueViolation(err)) throw new AppError(409, 'EMAIL_TAKEN');
    throw err;
  }
  await db.run('DELETE FROM email_codes WHERE user_id = $1', [row.id]);
  return address;
}

/** The address waiting for confirmation, if any (shown in the UI). */
async function pendingEmail(row) {
  const pending = await db.one('SELECT email_enc, expires_at FROM email_codes WHERE user_id = $1', [row.id]);
  return pending && pending.expires_at > Date.now() ? c.serverDecrypt(pending.email_enc, pendingAad(row.id)) : null;
}

module.exports = { startVerification, confirm, pendingEmail };
