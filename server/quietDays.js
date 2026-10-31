'use strict';
// "Quiet days": days the user marked as having no income or expense, so their logging streak doesn't break.
// A day can only be marked while it has no entries; adding an entry to it removes the mark.
const db = require('./db');
const { AppError } = require('./errors');
const { isValidDate } = require('./dates');

async function inRange(userId, start, end) {
  const rows = await db.all('SELECT day FROM quiet_days WHERE user_id = $1 AND day BETWEEN $2 AND $3', [userId, start, end]);
  return new Set(rows.map((r) => r.day));
}

async function isQuiet(userId, day) {
  return !!(await db.one('SELECT 1 AS x FROM quiet_days WHERE user_id = $1 AND day = $2', [userId, day]));
}

function validDay(day, today) {
  if (!isValidDate(day)) throw new AppError(400, 'INVALID_DATE');
  if (day > today) throw new AppError(400, 'FUTURE_DATE');
  return day;
}

async function mark(ctx, day) {
  validDay(day, ctx.today);
  const has = await db.one('SELECT 1 AS x FROM entries WHERE user_id = $1 AND entry_date = $2 LIMIT 1', [ctx.userId, day]);
  if (has) throw new AppError(409, 'DAY_HAS_ENTRIES');
  await db.run('INSERT INTO quiet_days (user_id, day, created_at) VALUES ($1, $2, $3) ON CONFLICT (user_id, day) DO NOTHING', [
    ctx.userId,
    day,
    Date.now(),
  ]);
}

async function unmark(userId, day) {
  await db.run('DELETE FROM quiet_days WHERE user_id = $1 AND day = $2', [userId, day]);
}

module.exports = { inRange, isQuiet, mark, unmark, validDay };
