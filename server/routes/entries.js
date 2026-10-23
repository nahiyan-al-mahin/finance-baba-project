'use strict';
const express = require('express');
const db = require('../db');
const entries = require('../entries');
const users = require('../users');
const c = require('../crypto');
const { AppError } = require('../errors');
const { todayIn, isValidDate } = require('../dates');

const router = express.Router();

function context(req) {
  const row = users.findById(req.session.userId);
  if (!row) throw new AppError(401, 'UNAUTHENTICATED');
  return { userId: row.id, dek: req.session.dek, today: todayIn(row.timezone) };
}

/** Changing anything on a day that has already passed needs a recent password confirmation. */
function assertCanModify(req, ctx, ...dates) {
  if (dates.every((d) => d >= ctx.today)) return;
  if (req.session.unlockedUntil > Date.now()) {
    db.prepare('UPDATE users SET past_edits = past_edits + 1 WHERE id = ?').run(ctx.userId);
    return;
  }
  throw new AppError(403, 'PAST_DAY_LOCKED');
}

router.get('/', (req, res) => {
  const ctx = context(req);
  const date = req.query.date || ctx.today;
  if (!isValidDate(date)) throw new AppError(400, 'INVALID_DATE');
  const list = entries.listByRange(ctx.userId, ctx.dek, date, date);
  res.json({ date, today: ctx.today, locked: date < ctx.today, entries: list, totals: entries.totals(list) });
});

router.post('/', (req, res) => {
  const ctx = context(req);
  const input = entries.validate(req.body, ctx.today);
  assertCanModify(req, ctx, input.date);
  res.status(201).json({ entry: entries.create(ctx.userId, ctx.dek, input) });
});

router.put('/:id', (req, res) => {
  const ctx = context(req);
  const existing = entries.getRow(ctx.userId, req.params.id);
  const input = entries.validate(req.body, ctx.today);
  assertCanModify(req, ctx, existing.entry_date, input.date);
  res.json({ entry: entries.update(ctx.userId, ctx.dek, req.params.id, input) });
});

router.delete('/:id', (req, res) => {
  const ctx = context(req);
  const existing = entries.getRow(ctx.userId, req.params.id);
  assertCanModify(req, ctx, existing.entry_date);
  entries.remove(ctx.userId, req.params.id);
  res.json({ ok: true });
});

// Warnings sent by an admin to this user.
const warnings = express.Router();
warnings.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT id, message_enc, created_at, acknowledged_at FROM warnings WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.session.userId);
  res.json({
    warnings: rows.map((w) => ({
      id: w.id,
      message: c.serverDecrypt(w.message_enc, `warning:${req.session.userId}`),
      createdAt: w.created_at,
      acknowledged: !!w.acknowledged_at,
    })),
  });
});
warnings.post('/:id/ack', (req, res) => {
  db.prepare('UPDATE warnings SET acknowledged_at = ? WHERE id = ? AND user_id = ? AND acknowledged_at IS NULL').run(
    Date.now(),
    Number(req.params.id),
    req.session.userId
  );
  res.json({ ok: true });
});

module.exports = { entriesRouter: router, warningsRouter: warnings, context };
