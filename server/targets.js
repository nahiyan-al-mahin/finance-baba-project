'use strict';
// Monthly spending targets. A target can be set or changed only on the first days of a month,
// and the user is notified (in the app, and by email) the first time spending goes over it.
const db = require('./db');
const c = require('./crypto');
const users = require('./users');
const entries = require('./entries');
const emails = require('./emails');
const { mail } = require('./mail');
const { AppError } = require('./errors');
const { periodRange } = require('./dates');
const { TARGET_EDIT_DAYS } = require('./config');

const aad = (userId, month) => `target:${userId}:${month}`;
const monthOf = (date) => date.slice(0, 7);
const canEditOn = (today) => Number(today.slice(8)) <= TARGET_EDIT_DAYS;

async function read(userId, dek, month) {
  const row = await db.one('SELECT data_enc FROM targets WHERE user_id = $1 AND month = $2', [userId, month]);
  return row ? c.decryptJSON(dek, row.data_enc, aad(userId, month)) : null;
}

function write(userId, dek, month, data) {
  return db.run(
    `INSERT INTO targets (user_id, month, data_enc, updated_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, month) DO UPDATE SET data_enc = $3, updated_at = $4`,
    [userId, month, c.encryptJSON(dek, data, aad(userId, month)), Date.now()]
  );
}

async function monthSpent(userId, dek, month) {
  const { start, end } = periodRange('month', `${month}-01`);
  return entries.totals(await entries.listByRange(userId, dek, start, end)).expense;
}

/** Status of the target for the month containing `today`. */
async function status({ userId, dek, today }) {
  const month = monthOf(today);
  const target = await read(userId, dek, month);
  const spent = await monthSpent(userId, dek, month);
  return {
    month,
    amount: target ? target.amount : null,
    spent,
    over: !!target && spent > target.amount,
    canEdit: canEditOn(today),
    editDays: TARGET_EDIT_DAYS,
  };
}

async function set(ctx, amountInput) {
  if (!canEditOn(ctx.today)) throw new AppError(403, 'TARGET_LOCKED');
  const amount = Math.round(Number(amountInput) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) throw new AppError(400, 'INVALID_AMOUNT');
  const month = monthOf(ctx.today);
  const spent = await monthSpent(ctx.userId, ctx.dek, month);
  // Already over the new amount? Treat it as notified so we don't email about it right away.
  await write(ctx.userId, ctx.dek, month, { amount, notifiedOver: spent > amount });
  return status(ctx);
}

async function remove(ctx) {
  if (!canEditOn(ctx.today)) throw new AppError(403, 'TARGET_LOCKED');
  await db.run('DELETE FROM targets WHERE user_id = $1 AND month = $2', [ctx.userId, monthOf(ctx.today)]);
  return status(ctx);
}

/**
 * Called after entries change in `month`. The first time spending goes over the target, the user is
 * emailed (if they have a confirmed address) and `newlyOver` is returned so the app can show an alert.
 */
async function checkAfterChange(ctx, month) {
  const target = await read(ctx.userId, ctx.dek, month);
  if (!target) return null;
  const spent = await monthSpent(ctx.userId, ctx.dek, month);
  const over = spent > target.amount;
  let newlyOver = false;
  if (over && !target.notifiedOver) {
    newlyOver = true;
    await write(ctx.userId, ctx.dek, month, { ...target, notifiedOver: true });
    const row = await users.findById(ctx.userId);
    const to = users.getEmail(row);
    if (to && mail.enabled()) {
      const name = users.getProfile(row, ctx.dek).displayName;
      // Email problems must never block saving the entry.
      await mail.send({ to, ...emails.overTarget({ lang: row.lang, name, month, target: target.amount, spent }) }).catch((err) => {
        console.error('[finance-baba] Over-target email failed:', err.message);
      });
    }
  } else if (!over && target.notifiedOver) {
    // Back under (e.g. an entry was deleted): allow a new alert if it goes over again.
    await write(ctx.userId, ctx.dek, month, { ...target, notifiedOver: false });
  }
  return { month, amount: target.amount, spent, over, newlyOver };
}

module.exports = { status, set, remove, checkAfterChange, read };
