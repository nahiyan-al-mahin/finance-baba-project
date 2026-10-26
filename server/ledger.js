'use strict';
/*
 * Loans and savings. Both are encrypted with the user's DEK like entries.
 *  - A loan (money borrowed or lent) stays open until it is fully repaid; repayments can be partial.
 *  - Savings is a log of money put in or taken out; the balance is the sum of the log.
 * Amounts are stored in the currency they were entered in and converted for display.
 */
const crypto = require('crypto');
const db = require('./db');
const c = require('./crypto');
const rates = require('./rates');
const { AppError } = require('./errors');
const { isValidDate, addDays } = require('./dates');

const round = (n) => Math.round(n * 100) / 100;
const loanAad = (userId) => `loan:${userId}`;
const savingAad = (userId) => `saving:${userId}`;

function rowId(id) {
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0 || n > 2147483647) throw new AppError(404, 'NOT_FOUND');
  return n;
}

function amountOf(value) {
  const amount = round(Number(value));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) throw new AppError(400, 'INVALID_AMOUNT');
  return amount;
}

function pastDate(value, today) {
  if (!isValidDate(value)) throw new AppError(400, 'INVALID_DATE');
  if (value > today) throw new AppError(400, 'FUTURE_DATE');
  return value;
}

function text(value, max, code, required = true) {
  const s = String(value ?? '').trim();
  if ((required && !s) || s.length > max) throw new AppError(400, code);
  return s;
}

const convert = (amount, from, money) => (money && from !== money.currency ? round(rates.convert(amount, from, money.currency, money.rates)) : amount);

// ---------------------------------------------------------------- loans

function validateLoan(body, today) {
  const b = body || {};
  if (!['borrowed', 'lent'].includes(b.direction)) throw new AppError(400, 'INVALID_DIRECTION');
  const dueDate = b.dueDate ? b.dueDate : null;
  if (dueDate !== null && !isValidDate(dueDate)) throw new AppError(400, 'INVALID_DATE');
  const date = pastDate(b.date, today);
  if (dueDate && dueDate < date) throw new AppError(400, 'INVALID_DUE_DATE');
  return {
    direction: b.direction,
    person: text(b.person, 80, 'INVALID_PERSON'),
    amount: amountOf(b.amount),
    date,
    dueDate,
    note: text(b.note, 200, 'INVALID_NOTE', false),
  };
}

/** A loan as the app sees it: original amounts plus `display` values in the user's currency. */
function viewLoan(row, dek, money, today) {
  const data = c.decryptJSON(dek, row.data_enc, loanAad(row.user_id));
  const paid = round(data.payments.reduce((sum, p) => sum + p.amount, 0));
  const remaining = round(Math.max(0, data.amount - paid));
  return {
    id: row.id,
    ...data,
    paid,
    remaining,
    open: !data.settledAt,
    overdue: !data.settledAt && !!data.dueDate && data.dueDate < today,
    createdAt: row.created_at,
    display: {
      currency: money ? money.currency : data.currency,
      amount: convert(data.amount, data.currency, money),
      paid: convert(paid, data.currency, money),
      remaining: convert(remaining, data.currency, money),
    },
  };
}

async function loanRow(userId, id) {
  const row = await db.one('SELECT * FROM loans WHERE id = $1 AND user_id = $2', [rowId(id), userId]);
  if (!row) throw new AppError(404, 'NOT_FOUND');
  return row;
}

async function saveLoan(userId, dek, id, data) {
  return db.one('UPDATE loans SET data_enc = $1, updated_at = $2 WHERE id = $3 AND user_id = $4 RETURNING *', [
    c.encryptJSON(dek, data, loanAad(userId)),
    Date.now(),
    id,
    userId,
  ]);
}

const rawLoan = (row, dek) => c.decryptJSON(dek, row.data_enc, loanAad(row.user_id));

async function listLoans({ userId, dek, money, today }) {
  const rows = await db.all('SELECT * FROM loans WHERE user_id = $1 ORDER BY created_at DESC, id DESC', [userId]);
  const loans = rows.map((r) => viewLoan(r, dek, money, today));
  // Open loans first, the oldest debts at the top; settled ones after, most recent first.
  const open = loans.filter((l) => l.open).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
  const settled = loans.filter((l) => !l.open).sort((a, b) => (a.settledAt < b.settledAt ? 1 : -1));
  const sum = (dir) => round(open.filter((l) => l.direction === dir).reduce((s, l) => s + l.display.remaining, 0));
  return {
    currency: money ? money.currency : rates.DEFAULT,
    totals: { owe: sum('borrowed'), owed: sum('lent'), open: open.length },
    loans: [...open, ...settled],
  };
}

async function createLoan(ctx, body) {
  const input = validateLoan(body, ctx.today);
  const data = { ...input, currency: ctx.currency, payments: [], settledAt: null };
  const now = Date.now();
  const row = await db.one('INSERT INTO loans (user_id, data_enc, created_at, updated_at) VALUES ($1, $2, $3, $4) RETURNING *', [
    ctx.userId,
    c.encryptJSON(ctx.dek, data, loanAad(ctx.userId)),
    now,
    now,
  ]);
  return viewLoan(row, ctx.dek, ctx.money, ctx.today);
}

/** Edits the loan's details. The amount can't go below what has already been repaid. */
async function updateLoan(ctx, id, body) {
  const row = await loanRow(ctx.userId, id);
  const old = rawLoan(row, ctx.dek);
  const input = validateLoan({ ...body, direction: old.direction }, ctx.today);
  const paid = old.payments.reduce((s, p) => s + p.amount, 0);
  if (input.amount < round(paid)) throw new AppError(400, 'LOAN_BELOW_PAID');
  const data = { ...old, ...input };
  data.settledAt = round(paid) >= input.amount ? old.settledAt || old.payments.at(-1)?.date || ctx.today : null;
  return { before: old, loan: viewLoan(await saveLoan(ctx.userId, ctx.dek, row.id, data), ctx.dek, ctx.money, ctx.today) };
}

/** Records a repayment (in the loan's own currency). Paying the full remaining amount closes the loan. */
async function addPayment(ctx, id, body) {
  const row = await loanRow(ctx.userId, id);
  const data = rawLoan(row, ctx.dek);
  if (data.settledAt) throw new AppError(400, 'LOAN_SETTLED');
  const paid = round(data.payments.reduce((s, p) => s + p.amount, 0));
  const remaining = round(data.amount - paid);
  const amount = body?.full ? remaining : amountOf(body?.amount);
  if (amount > remaining) throw new AppError(400, 'PAYMENT_TOO_BIG');
  const date = pastDate(body?.date, ctx.today);
  if (date < data.date) throw new AppError(400, 'PAYMENT_BEFORE_LOAN');
  data.payments.push({ id: crypto.randomBytes(6).toString('hex'), date, amount, note: text(body?.note, 200, 'INVALID_NOTE', false) });
  data.payments.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (round(paid + amount) >= data.amount) data.settledAt = date;
  return { date, loan: viewLoan(await saveLoan(ctx.userId, ctx.dek, row.id, data), ctx.dek, ctx.money, ctx.today) };
}

async function removePayment(ctx, id, paymentId) {
  const row = await loanRow(ctx.userId, id);
  const data = rawLoan(row, ctx.dek);
  const payment = data.payments.find((p) => p.id === paymentId);
  if (!payment) throw new AppError(404, 'NOT_FOUND');
  data.payments = data.payments.filter((p) => p !== payment);
  data.settledAt = null; // something is owed again
  return { date: payment.date, loan: viewLoan(await saveLoan(ctx.userId, ctx.dek, row.id, data), ctx.dek, ctx.money, ctx.today) };
}

async function loanDates(ctx, id) {
  const data = rawLoan(await loanRow(ctx.userId, id), ctx.dek);
  return [data.date, ...data.payments.map((p) => p.date)];
}

async function removeLoan(ctx, id) {
  await db.run('DELETE FROM loans WHERE id = $1 AND user_id = $2', [rowId(id), ctx.userId]);
}

// ---------------------------------------------------------------- savings

function viewSaving(row, dek, money) {
  const data = c.decryptJSON(dek, row.data_enc, savingAad(row.user_id));
  const amount = convert(data.amount, data.currency, money);
  return {
    id: row.id,
    date: row.entry_date,
    createdAt: row.created_at,
    ...data,
    amount,
    ...(money && data.currency !== money.currency ? { originalAmount: data.amount, converted: true } : {}),
  };
}

async function savingsLogs(userId, dek, money) {
  const rows = await db.all('SELECT * FROM savings WHERE user_id = $1 ORDER BY entry_date DESC, created_at DESC, id DESC', [userId]);
  return rows.map((r) => viewSaving(r, dek, money));
}

const signed = (l) => (l.type === 'deposit' ? l.amount : -l.amount);

/** Balance, this month's movement, the last 6 months, and the full log. */
async function savingsSummary({ userId, dek, money, today }) {
  const logs = await savingsLogs(userId, dek, money);
  const balance = round(logs.reduce((s, l) => s + signed(l), 0));
  const thisMonth = today.slice(0, 7);
  const months = [];
  let m = `${thisMonth}-01`;
  for (let i = 0; i < 6; i++) {
    months.unshift(m.slice(0, 7));
    m = `${addDays(m, -1).slice(0, 7)}-01`;
  }
  const byMonth = months.map((month) => {
    const inMonth = logs.filter((l) => l.date.startsWith(month));
    const added = round(inMonth.filter((l) => l.type === 'deposit').reduce((s, l) => s + l.amount, 0));
    const withdrawn = round(inMonth.filter((l) => l.type === 'withdraw').reduce((s, l) => s + l.amount, 0));
    return { month, added, withdrawn, net: round(added - withdrawn) };
  });
  return {
    currency: money ? money.currency : rates.DEFAULT,
    balance,
    month: byMonth.at(-1),
    months: byMonth,
    // Only months since the first log count, so a new user isn't told they "didn't save" before they started.
    savedMonths: byMonth.filter((b) => logs.length && b.month >= logs.at(-1).date.slice(0, 7) && b.net > 0).length,
    trackedMonths: logs.length ? byMonth.filter((b) => b.month >= logs.at(-1).date.slice(0, 7)).length : 0,
    logs,
  };
}

/** Savings balance at the end of `date` and the money moved within [start, end] (for reports). */
async function savingsForRange({ userId, dek, money }, start, end) {
  const logs = (await savingsLogs(userId, dek, money)).filter((l) => l.date <= end);
  const inRange = logs.filter((l) => l.date >= start);
  return {
    balance: round(logs.reduce((s, l) => s + signed(l), 0)),
    added: round(inRange.filter((l) => l.type === 'deposit').reduce((s, l) => s + l.amount, 0)),
    withdrawn: round(inRange.filter((l) => l.type === 'withdraw').reduce((s, l) => s + l.amount, 0)),
    count: inRange.length,
  };
}

async function addSaving(ctx, body) {
  const b = body || {};
  if (!['deposit', 'withdraw'].includes(b.type)) throw new AppError(400, 'INVALID_TYPE');
  const date = pastDate(b.date, ctx.today);
  const amount = amountOf(b.amount);
  if (b.type === 'withdraw') {
    // You can't take out more than you have (checked in the current currency).
    const { balance } = await savingsSummary(ctx);
    if (amount > balance + 0.005) throw new AppError(400, 'NOT_ENOUGH_SAVINGS', { balance });
  }
  const data = { type: b.type, amount, currency: ctx.currency, note: text(b.note, 200, 'INVALID_NOTE', false) };
  const now = Date.now();
  const row = await db.one('INSERT INTO savings (user_id, entry_date, data_enc, created_at) VALUES ($1, $2, $3, $4) RETURNING *', [
    ctx.userId,
    date,
    c.encryptJSON(ctx.dek, data, savingAad(ctx.userId)),
    now,
  ]);
  return viewSaving(row, ctx.dek, ctx.money);
}

async function savingDate(ctx, id) {
  const row = await db.one('SELECT entry_date FROM savings WHERE id = $1 AND user_id = $2', [rowId(id), ctx.userId]);
  if (!row) throw new AppError(404, 'NOT_FOUND');
  return row.entry_date;
}

async function removeSaving(ctx, id) {
  await db.run('DELETE FROM savings WHERE id = $1 AND user_id = $2', [rowId(id), ctx.userId]);
}

/** Open loans as of the end of a period (for reports). */
async function loansForReport(ctx, end) {
  const { loans } = await listLoans(ctx);
  const open = loans
    .filter((l) => l.date <= end && (!l.settledAt || l.settledAt > end))
    .map((l) => {
      // What was still owed on the last day of the period.
      const paid = l.payments.filter((p) => p.date <= end).reduce((s, p) => s + p.amount, 0);
      return { ...l, remainingAtEnd: convert(round(l.amount - paid), l.currency, ctx.money) };
    });
  const owe = round(open.filter((l) => l.direction === 'borrowed').reduce((s, l) => s + l.remainingAtEnd, 0));
  const owed = round(open.filter((l) => l.direction === 'lent').reduce((s, l) => s + l.remainingAtEnd, 0));
  return { open, owe, owed };
}

module.exports = {
  listLoans,
  createLoan,
  updateLoan,
  addPayment,
  removePayment,
  removeLoan,
  loanDates,
  savingsSummary,
  savingsForRange,
  addSaving,
  removeSaving,
  savingDate,
  loansForReport,
};
