'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const users = require('../users');
const sessions = require('../sessions');
const { AppError } = require('../errors');
const { isValidTimezone, todayIn } = require('../dates');
const { requireAuth, startSession, endSession } = require('../middleware');
const { DEFAULT_TZ, UNLOCK_MS } = require('../config');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'TOO_MANY_REQUESTS' },
});

function currentUser(req) {
  const row = users.findById(req.session.userId);
  if (!row) throw new AppError(401, 'UNAUTHENTICATED');
  return row;
}

function me(row, dek) {
  return { ...users.toPublic(row, dek), today: todayIn(row.timezone) };
}

router.post('/signup', authLimiter, async (req, res) => {
  const { username, displayName, password, timezone } = req.body || {};
  const tz = isValidTimezone(timezone) ? timezone : DEFAULT_TZ;
  const { user, dek, recoveryCode } = await users.createUser({ username, displayName, password, timezone: tz });
  startSession(res, user, dek);
  res.status(201).json({ user: me(user, dek), recoveryCode });
});

router.post('/login', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  const { user, dek } = await users.login(username, password);
  startSession(res, user, dek);
  res.json({ user: me(user, dek) });
});

router.post('/logout', (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const row = currentUser(req);
  res.json({ user: me(row, req.session.dek), unlockedUntil: req.session.unlockedUntil });
});

/** Re-enter the password to edit past days. Unlocks for a few minutes. */
router.post('/unlock', authLimiter, requireAuth, async (req, res) => {
  await users.unlockWithPassword(currentUser(req), req.body?.password);
  req.session.unlockedUntil = Date.now() + UNLOCK_MS;
  res.json({ unlockedUntil: req.session.unlockedUntil });
});

router.post('/change-password', authLimiter, requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const row = currentUser(req);
  await users.changePassword(row, currentPassword, newPassword);
  sessions.destroyAllForUser(row.id, req.sid); // sign out other devices
  res.json({ ok: true });
});

router.post('/recover', authLimiter, async (req, res) => {
  const { username, recoveryCode, newPassword } = req.body || {};
  const { user, dek, recoveryCode: newCode } = await users.recover(username, recoveryCode, newPassword);
  sessions.destroyAllForUser(user.id);
  startSession(res, user, dek);
  res.json({ user: me(user, dek), recoveryCode: newCode });
});

router.post('/onboarded', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET onboarded = 1 WHERE id = ?').run(req.session.userId);
  res.json({ ok: true });
});

router.patch('/profile', requireAuth, (req, res) => {
  const row = currentUser(req);
  const displayName = users.validateDisplayName(req.body?.displayName);
  users.updateProfile(row, req.session.dek, { ...users.getProfile(row, req.session.dek), displayName });
  res.json({ user: me(users.findById(row.id), req.session.dek) });
});

router.delete('/account', authLimiter, requireAuth, async (req, res) => {
  const row = currentUser(req);
  if (row.role === 'admin') throw new AppError(403, 'FORBIDDEN');
  await users.unlockWithPassword(row, req.body?.password);
  db.prepare('DELETE FROM users WHERE id = ?').run(row.id); // entries & warnings cascade
  sessions.destroyAllForUser(row.id);
  endSession(req, res);
  res.json({ ok: true });
});

module.exports = router;
