'use strict';
// In-memory session store. The user's decrypted data key lives here and nowhere else,
// so a server restart simply logs everyone out (by design).
const crypto = require('crypto');
const { randomToken } = require('./crypto');
const { SESSION_IDLE_MS, SESSION_MAX_MS } = require('./config');

const sessions = new Map();
const keyOf = (sid) => crypto.createHash('sha256').update(String(sid)).digest('hex');

function create(user, dek) {
  const sid = randomToken(32);
  const now = Date.now();
  sessions.set(keyOf(sid), { userId: user.id, role: user.role, dek, createdAt: now, lastSeen: now, unlockedUntil: 0 });
  return sid;
}

function isExpired(s, now) {
  return now - s.lastSeen > SESSION_IDLE_MS || now - s.createdAt > SESSION_MAX_MS;
}

function get(sid) {
  if (!sid) return null;
  const key = keyOf(sid);
  const s = sessions.get(key);
  if (!s) return null;
  const now = Date.now();
  if (isExpired(s, now)) {
    destroyEntry(key, s);
    return null;
  }
  s.lastSeen = now;
  return s;
}

function destroyEntry(key, s) {
  s.dek.fill(0);
  sessions.delete(key);
}

function destroy(sid) {
  const key = keyOf(sid);
  const s = sessions.get(key);
  if (s) destroyEntry(key, s);
}

function destroyAllForUser(userId, exceptSid) {
  const keep = exceptSid ? keyOf(exceptSid) : null;
  for (const [key, s] of sessions) if (s.userId === userId && key !== keep) destroyEntry(key, s);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, s] of sessions) if (isExpired(s, now)) destroyEntry(key, s);
}, 60 * 1000).unref();

module.exports = { create, get, destroy, destroyAllForUser };
