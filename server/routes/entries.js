'use strict';
const express = require('express');
const db = require('../db');
const entries = require('../entries');
const users = require('../users');
const c = require('../crypto');
const { AppError } = require('../errors');
const { todayIn, isValidDate } = require('../dates');
const targets = require('../targets');
const rates = require('../rates');

const router = express.Router();

async function context(req) {
  const row = await users.findById(req.session.userId);
  if (!row) throw new AppError(401, 'UNAUTHENTICATED');
  const { currency, history } = users.currencyOf(users.getProfile(row, req.session.dek));
  return {
    userId: row.id,
    dek: req.session.dek,
    today: todayIn(row.timezone),
    currency,
    currencyHistory: history,
    // Totals are shown in the user's currency; entries in other currencies are converted at the live rate.
    money: { currency, rates: await rates.getRates() },
  };
}

/** Changing anything on a day that has already passed needs a recent password confirmation. */
async function assertCanModify(req, ctx, ...dates) {
  if (dates.every((d) => d >= ctx.today)) return;
  if (req.session.unlockedUntil > Date.now()) {
    await db.run('UPDATE users SET past_edits = past_edits + 1 WHERE id = $1', [ctx.userId]);
    return;
  }
  throw new AppError(403, 'PAST_DAY_LOCKED');
}

router.get('/', async (req, res) => {
  const ctx = await context(req);
  const date = req.query.date || ctx.today;
  if (!isValidDate(date)) throw new AppError(400, 'INVALID_DATE');
  const list = await entries.listByRange(ctx.userId, ctx.dek, date, date, ctx.money);
  res.json({ date, today: ctx.today, locked: date < ctx.today, currency: ctx.currency, entries: list, totals: entries.totals(list) });
});

/** Re-checks the monthly target for every month touched; returns the result for the current month. */
async function checkTargets(ctx, ...dates) {
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
  let current = null;
  for (const month of months) {
    const result = await targets.checkAfterChange(ctx, month);
    if (month === ctx.today.slice(0, 7)) current = result;
  }
  return current;
}

router.post('/', async (req, res) => {
  const ctx = await context(req);
  const input = entries.validate(req.body, ctx.today, ctx.currency);
  await assertCanModify(req, ctx, input.date);
  const entry = await entries.create(ctx.userId, ctx.dek, input);
  res.status(201).json({ entry, target: await checkTargets(ctx, input.date) });
});

router.put('/:id', async (req, res) => {
  const ctx = await context(req);
  const existing = await entries.getRow(ctx.userId, req.params.id);
  // An edited entry keeps the currency it was entered in.
  const input = entries.validate(req.body, ctx.today, entries.currencyOfRow(existing, ctx.dek));
  await assertCanModify(req, ctx, existing.entry_date, input.date);
  const entry = await entries.update(ctx.userId, ctx.dek, req.params.id, input);
  res.json({ entry, target: await checkTargets(ctx, existing.entry_date, input.date) });
});

router.delete('/:id', async (req, res) => {
  const ctx = await context(req);
  const existing = await entries.getRow(ctx.userId, req.params.id);
  await assertCanModify(req, ctx, existing.entry_date);
  await entries.remove(ctx.userId, req.params.id);
  res.json({ ok: true, target: await checkTargets(ctx, existing.entry_date) });
});

// Warnings sent by an admin to this user.
const warnings = express.Router();
warnings.get('/', async (req, res) => {
  const rows = await db.all(
    'SELECT id, message_enc, created_at, acknowledged_at FROM warnings WHERE user_id = $1 ORDER BY created_at DESC',
    [req.session.userId]
  );
  res.json({
    warnings: rows.map((w) => ({
      id: w.id,
      message: c.serverDecrypt(w.message_enc, `warning:${req.session.userId}`),
      createdAt: w.created_at,
      acknowledged: !!w.acknowledged_at,
    })),
  });
});
warnings.post('/:id/ack', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) throw new AppError(404, 'NOT_FOUND');
  await db.run('UPDATE warnings SET acknowledged_at = $1 WHERE id = $2 AND user_id = $3 AND acknowledged_at IS NULL', [
    Date.now(),
    id,
    req.session.userId,
  ]);
  res.json({ ok: true });
});

module.exports = { entriesRouter: router, warningsRouter: warnings, context, assertCanModify };
