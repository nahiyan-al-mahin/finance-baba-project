'use strict';
// Admins never receive names, usernames, amounts or notes — only counts and activity signals
// keyed by a random public ID, which is enough to spot abuse and send a warning.
const express = require('express');
const db = require('../db');
const c = require('../crypto');
const { AppError } = require('../errors');

const router = express.Router();
const DAY = 24 * 60 * 60 * 1000;

router.get('/stats', async (req, res) => {
  const now = Date.now();
  const s = await db.one(
    `SELECT
       (SELECT COUNT(*) FROM users WHERE role = 'user') AS total,
       (SELECT COUNT(*) FROM users WHERE role = 'user' AND last_active_at > $1) AS active,
       (SELECT COUNT(*) FROM users WHERE role = 'user' AND created_at > $2) AS fresh,
       (SELECT COUNT(*) FROM users WHERE role = 'user' AND locked_until > $3) AS locked,
       (SELECT COUNT(*) FROM warnings WHERE acknowledged_at IS NULL) AS open_warnings`,
    [now - 7 * DAY, now - 30 * DAY, now]
  );
  res.json({ totalUsers: s.total, activeLast7Days: s.active, newLast30Days: s.fresh, lockedNow: s.locked, openWarnings: s.open_warnings });
});

router.get('/users', async (req, res) => {
  const now = Date.now();
  const rows = await db.all(
    `SELECT u.public_id, u.created_at, u.last_active_at, u.total_failed_logins, u.past_edits, u.locked_until,
         (SELECT COUNT(*) FROM entries e WHERE e.user_id = u.id) AS entry_count,
         (SELECT COUNT(*) FROM entries e WHERE e.user_id = u.id AND e.created_at > $1) AS entries_24h,
         (SELECT COUNT(*) FROM warnings w WHERE w.user_id = u.id) AS warning_count
       FROM users u WHERE u.role = 'user' ORDER BY u.created_at DESC`,
    [now - DAY]
  );
  res.json({
    users: rows.map((r) => {
      const flags = [];
      if (r.total_failed_logins >= 10) flags.push('MANY_FAILED_LOGINS');
      if (r.entries_24h >= 200) flags.push('ENTRY_FLOOD');
      if (r.past_edits >= 50) flags.push('MANY_PAST_EDITS');
      if (r.locked_until > now) flags.push('LOCKED');
      return {
        id: r.public_id,
        createdAt: r.created_at,
        lastActiveAt: r.last_active_at,
        entryCount: r.entry_count,
        entriesLast24h: r.entries_24h,
        failedLogins: r.total_failed_logins,
        pastEdits: r.past_edits,
        warnings: r.warning_count,
        flags,
      };
    }),
  });
});

router.post('/users/:publicId/warnings', async (req, res) => {
  const user = await db.one("SELECT id FROM users WHERE public_id = $1 AND role = 'user'", [req.params.publicId]);
  if (!user) throw new AppError(404, 'NOT_FOUND');
  const message = String(req.body?.message || '').trim();
  if (message.length < 5 || message.length > 500) throw new AppError(400, 'INVALID_MESSAGE');
  await db.run('INSERT INTO warnings (user_id, message_enc, created_at) VALUES ($1, $2, $3)', [
    user.id,
    c.serverEncrypt(message, `warning:${user.id}`),
    Date.now(),
  ]);
  res.status(201).json({ ok: true });
});

router.get('/warnings', async (req, res) => {
  const rows = await db.all(
    `SELECT w.id, w.user_id, w.message_enc, w.created_at, w.acknowledged_at, u.public_id
     FROM warnings w JOIN users u ON u.id = w.user_id ORDER BY w.created_at DESC LIMIT 200`
  );
  res.json({
    warnings: rows.map((w) => ({
      id: w.id,
      userId: w.public_id,
      message: c.serverDecrypt(w.message_enc, `warning:${w.user_id}`),
      createdAt: w.created_at,
      acknowledged: !!w.acknowledged_at,
    })),
  });
});

module.exports = router;
