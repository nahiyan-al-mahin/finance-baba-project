'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const users = require('../users');
const sessions = require('../sessions');
const { AppError } = require('../errors');
const { isValidTimezone, todayIn } = require('../dates');
const { requireAuth, startSession, endSession } = require('../middleware');
const { google, rememberPending, getPending, dropPending } = require('../google');
const { PgStore } = require('../rateLimitStore');
const { DEFAULT_TZ, UNLOCK_MS, GOOGLE_CLIENT_ID } = require('../config');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: new PgStore('auth'),
  message: { error: 'TOO_MANY_REQUESTS' },
});

async function currentUser(req) {
  const row = await users.findById(req.session.userId);
  if (!row) throw new AppError(401, 'UNAUTHENTICATED');
  return row;
}

function me(row, dek) {
  return { ...users.toPublic(row, dek), today: todayIn(row.timezone) };
}

/** Public settings the login page needs. */
router.get('/config', (req, res) => {
  res.json({ googleClientId: google.enabled() ? GOOGLE_CLIENT_ID : null });
});

router.post('/signup', authLimiter, async (req, res) => {
  const { username, displayName, password, timezone } = req.body || {};
  const tz = isValidTimezone(timezone) ? timezone : DEFAULT_TZ;
  const { user, dek, recoveryCode } = await users.createUser({ username, displayName, password, timezone: tz });
  await startSession(res, user, dek);
  res.status(201).json({ user: me(user, dek), recoveryCode });
});

router.post('/login', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  const { user, dek } = await users.login(username, password);
  await startSession(res, user, dek);
  res.json({ user: me(user, dek) });
});

// ---- Sign in with Google (Gmail)
router.post('/google', authLimiter, async (req, res) => {
  const identity = await google.verify(req.body?.credential);
  const found = await users.loginWithGoogle(identity.sub);
  if (found) {
    await startSession(res, found.user, found.dek);
    return res.json({ user: me(found.user, found.dek) });
  }
  // First time with this Google account: the browser asks for a username + password next.
  const suggested = users.normalizeUsername(identity.email.split('@')[0]).replace(/[^a-z0-9_.]/g, '').slice(0, 30);
  const signupToken = await rememberPending(identity);
  res.json({ needsSignup: true, signupToken, email: identity.email, name: identity.name, username: suggested });
});

router.post('/google/signup', authLimiter, async (req, res) => {
  const { signupToken, username, displayName, password, timezone } = req.body || {};
  const identity = await getPending(signupToken);
  if (await users.findByGoogle(identity.sub)) throw new AppError(409, 'GOOGLE_IN_USE');
  const tz = isValidTimezone(timezone) ? timezone : DEFAULT_TZ;
  const { user, dek, recoveryCode } = await users.createUser({ username, displayName, password, timezone: tz });
  await users.linkGoogle(user, dek, identity);
  await dropPending(signupToken);
  await startSession(res, user, dek);
  res.status(201).json({ user: me(await users.findById(user.id), dek), recoveryCode });
});

router.post('/google/link', authLimiter, requireAuth, async (req, res) => {
  const identity = await google.verify(req.body?.credential);
  const row = await currentUser(req);
  await users.linkGoogle(row, req.session.dek, identity);
  res.json({ user: me(await users.findById(row.id), req.session.dek) });
});

router.post('/google/unlink', authLimiter, requireAuth, async (req, res) => {
  const row = await currentUser(req);
  await users.unlinkGoogle(row, req.body?.password);
  res.json({ user: me(await users.findById(row.id), req.session.dek) });
});

router.post('/logout', async (req, res) => {
  await endSession(req, res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const row = await currentUser(req);
  res.json({ user: me(row, req.session.dek), unlockedUntil: req.session.unlockedUntil });
});

/** Re-enter the password to edit past days. Unlocks for a few minutes. */
router.post('/unlock', authLimiter, requireAuth, async (req, res) => {
  await users.unlockWithPassword(await currentUser(req), req.body?.password);
  await sessions.setUnlockedUntil(req.session, Date.now() + UNLOCK_MS);
  res.json({ unlockedUntil: req.session.unlockedUntil });
});

router.post('/change-password', authLimiter, requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const row = await currentUser(req);
  await users.changePassword(row, currentPassword, newPassword);
  await sessions.destroyAllForUser(row.id, req.sid); // sign out other devices
  res.json({ ok: true });
});

router.post('/recover', authLimiter, async (req, res) => {
  const { username, recoveryCode, newPassword } = req.body || {};
  const { user, dek, recoveryCode: newCode } = await users.recover(username, recoveryCode, newPassword);
  await sessions.destroyAllForUser(user.id);
  await startSession(res, user, dek);
  res.json({ user: me(user, dek), recoveryCode: newCode });
});

router.post('/onboarded', requireAuth, async (req, res) => {
  await db.run('UPDATE users SET onboarded = 1 WHERE id = $1', [req.session.userId]);
  res.json({ ok: true });
});

router.patch('/profile', requireAuth, async (req, res) => {
  const row = await currentUser(req);
  const displayName = users.validateDisplayName(req.body?.displayName);
  await users.updateProfile(row, req.session.dek, { ...users.getProfile(row, req.session.dek), displayName });
  res.json({ user: me(await users.findById(row.id), req.session.dek) });
});

router.delete('/account', authLimiter, requireAuth, async (req, res) => {
  const row = await currentUser(req);
  if (row.role === 'admin') throw new AppError(403, 'FORBIDDEN');
  await users.unlockWithPassword(row, req.body?.password);
  await db.run('DELETE FROM users WHERE id = $1', [row.id]); // entries, warnings and sessions cascade
  await endSession(req, res);
  res.json({ ok: true });
});

module.exports = router;
