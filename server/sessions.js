'use strict';
/*
 * Login sessions, stored in the database so they work on serverless hosts (Vercel) where
 * nothing stays in memory between requests.
 *
 * Split-key design: the browser cookie holds a random token. The database stores only
 *   - sha256(token) to find the session, and
 *   - the user's data key (DEK) encrypted with a key derived from token + server secret.
 * So a stolen database cannot unlock anyone's data: the token exists only in the user's cookie.
 */
const crypto = require('crypto');
const db = require('./db');
const c = require('./crypto');
const { SECRET, SESSION_IDLE_MS, SESSION_MAX_MS } = require('./config');

const TOUCH_EVERY_MS = 60 * 1000; // write last_seen at most once a minute

const idHash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const tokenKey = (token) => Buffer.from(crypto.hkdfSync('sha256', Buffer.from(String(token)), SECRET, 'finance-baba:session', 32));

async function create(user, dek) {
  const token = c.randomToken(32);
  const hash = idHash(token);
  const now = Date.now();
  await db.run(
    'INSERT INTO sessions (id_hash, user_id, role, dek_enc, created_at, last_seen) VALUES ($1, $2, $3, $4, $5, $6)',
    [hash, user.id, user.role, c.encrypt(tokenKey(token), dek, `session:${hash}`), now, now]
  );
  // Housekeeping: drop expired sessions now and then.
  if (Math.random() < 0.1) await purgeExpired();
  return token;
}

const isExpired = (row, now) => now - row.last_seen > SESSION_IDLE_MS || now - row.created_at > SESSION_MAX_MS;

/** Returns { userId, role, dek, unlockedUntil, idHash } or null. */
async function get(token) {
  if (!token || typeof token !== 'string' || token.length > 100) return null;
  const hash = idHash(token);
  const row = await db.one('SELECT * FROM sessions WHERE id_hash = $1', [hash]);
  if (!row) return null;
  const now = Date.now();
  if (isExpired(row, now)) {
    await db.run('DELETE FROM sessions WHERE id_hash = $1', [hash]);
    return null;
  }
  let dek;
  try {
    dek = c.decrypt(tokenKey(token), row.dek_enc, `session:${hash}`);
  } catch {
    return null;
  }
  if (now - row.last_seen > TOUCH_EVERY_MS) {
    await db.run('UPDATE sessions SET last_seen = $1 WHERE id_hash = $2', [now, hash]);
  }
  return { userId: row.user_id, role: row.role, dek, unlockedUntil: row.unlocked_until, idHash: hash, lastSeen: row.last_seen };
}

function setUnlockedUntil(session, until) {
  session.unlockedUntil = until;
  return db.run('UPDATE sessions SET unlocked_until = $1 WHERE id_hash = $2', [until, session.idHash]);
}

function destroy(token) {
  return db.run('DELETE FROM sessions WHERE id_hash = $1', [idHash(token)]);
}

function destroyAllForUser(userId, exceptToken) {
  return exceptToken
    ? db.run('DELETE FROM sessions WHERE user_id = $1 AND id_hash <> $2', [userId, idHash(exceptToken)])
    : db.run('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

function purgeExpired() {
  const now = Date.now();
  return db.run('DELETE FROM sessions WHERE last_seen < $1 OR created_at < $2', [now - SESSION_IDLE_MS, now - SESSION_MAX_MS]);
}

module.exports = { create, get, setUnlockedUntil, destroy, destroyAllForUser };
