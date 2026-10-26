'use strict';
/*
 * Month-end email reports. Runs once a day (Vercel Cron, or an hourly timer on your own server).
 * For every user with monthly reports on and a confirmed email, it sends last month's PDF once,
 * using the user's own time zone to decide when "last month" has ended.
 */
const db = require('./db');
const users = require('./users');
const targets = require('./targets');
const emails = require('./emails');
const { mail } = require('./mail');
const { summarize } = require('./reports/summary');
const { reportBuffer } = require('./reports/pdf');
const { todayIn, previousMonth } = require('./dates');
const rates = require('./rates');

const TIME_BUDGET_MS = 45 * 1000; // stay well inside the serverless time limit; the rest goes out on the next run

async function sendOne(row) {
  const today = todayIn(row.timezone);
  const month = previousMonth(today);
  if (row.last_report_month && row.last_report_month >= month) return 'up-to-date';

  // Claim the month first so two overlapping runs can never email the same report twice.
  const claimed = await db.one(
    'UPDATE users SET last_report_month = $1 WHERE id = $2 AND (last_report_month IS NULL OR last_report_month < $1) RETURNING id',
    [month, row.id]
  );
  if (!claimed) return 'up-to-date';

  // Accounts created after that month ended have nothing to report.
  const createdMonth = new Date(row.created_at).toISOString().slice(0, 7);
  if (createdMonth > month) return 'skipped';

  try {
    const dek = users.reportKey(row);
    const profile = users.getProfile(row, dek);
    const { currency, history } = users.currencyOf(profile);
    const ctx = { userId: row.id, dek, today, currencyHistory: history, money: { currency, rates: await rates.getRates() } };
    const summary = await summarize(ctx, 'month', `${month}-01`);
    if (!summary.entries.length) return 'empty'; // nothing logged: don't send an empty report
    const target = await targets.read(row.id, dek, month, ctx.money);
    const pdf = await reportBuffer({ lang: row.lang, summary, profile, publicId: row.public_id, target: target?.amount });
    const message = emails.monthlyReport({ lang: row.lang, name: profile.displayName, month, totals: summary.totals, target: target?.amount, currency });
    await mail.send({
      to: users.getEmail(row),
      ...message,
      attachments: [{ filename: `finance-baba-${month}.pdf`, content: pdf, contentType: 'application/pdf' }],
    });
    return 'sent';
  } catch (err) {
    // Release the claim so the next run tries again.
    await db.run('UPDATE users SET last_report_month = $1 WHERE id = $2', [row.last_report_month, row.id]);
    throw err;
  }
}

/** Sends every report that is due. Returns counts, for logs and the cron response. */
async function runMonthlyReports() {
  const result = { sent: 0, empty: 0, skipped: 0, failed: 0, pending: 0 };
  if (!mail.enabled()) return { ...result, disabled: true };
  const started = Date.now();
  const rows = await db.all(
    "SELECT * FROM users WHERE role = 'user' AND email_verified = 1 AND report_dek IS NOT NULL ORDER BY last_report_month NULLS FIRST, id"
  );
  for (const row of rows) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      result.pending++;
      continue;
    }
    try {
      const outcome = await sendOne(row);
      if (outcome !== 'up-to-date') result[outcome]++;
    } catch (err) {
      result.failed++;
      console.error(`[finance-baba] Monthly report for ${row.public_id} failed:`, err.message);
    }
  }
  return result;
}

module.exports = { runMonthlyReports };
