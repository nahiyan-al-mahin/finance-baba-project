'use strict';
// Data access for finance entries. Everything except the date is encrypted with the user's DEK.
const db = require('./db');
const c = require('./crypto');
const CATEGORIES = require('../shared/categories');
const { AppError } = require('./errors');
const { isValidDate } = require('./dates');
const rates = require('./rates');

const aad = (userId) => `entry:${userId}`;

function decryptRow(row, dek) {
  const data = c.decryptJSON(dek, row.data_enc, aad(row.user_id));
  // Entries saved before currencies existed are in Taka.
  return { id: row.id, date: row.entry_date, createdAt: row.created_at, updatedAt: row.updated_at, currency: rates.DEFAULT, ...data };
}

/** `currency` is the user's chosen currency: every entry is stored in the currency it was entered in. */
function validate(body, today, currency = rates.DEFAULT) {
  const { date, type, category } = body || {};
  if (!isValidDate(date)) throw new AppError(400, 'INVALID_DATE');
  if (date > today) throw new AppError(400, 'FUTURE_DATE');
  if (!['expense', 'income'].includes(type)) throw new AppError(400, 'INVALID_TYPE');
  if (!CATEGORIES[type].some((cat) => cat.id === category)) throw new AppError(400, 'INVALID_CATEGORY');
  const amount = Math.round(Number(body.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) throw new AppError(400, 'INVALID_AMOUNT');
  const note = String(body.note || '').trim();
  if (note.length < 1 || note.length > 200) throw new AppError(400, 'INVALID_NOTE');
  return { date, data: { type, amount, category, note, currency } };
}

/**
 * Entries in a date range. With `money` ({ currency, rates }), amounts in other currencies are converted
 * to that currency (`originalAmount` / `currency` keep what was entered), so totals can be added up.
 */
async function listByRange(userId, dek, start, end, money = null) {
  const rows = await db.all(
    'SELECT * FROM entries WHERE user_id = $1 AND entry_date BETWEEN $2 AND $3 ORDER BY entry_date, created_at, id',
    [userId, start, end]
  );
  const list = rows.map((row) => decryptRow(row, dek));
  return money ? list.map((e) => toCurrency(e, money)) : list;
}

function currencyOfRow(row, dek) {
  return decryptRow(row, dek).currency;
}

function toCurrency(e, money) {
  if (e.currency === money.currency) return e;
  const amount = Math.round(rates.convert(e.amount, e.currency, money.currency, money.rates) * 100) / 100;
  return { ...e, amount, originalAmount: e.amount, converted: true };
}

function entryId(id) {
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0 || n > 2147483647) throw new AppError(404, 'NOT_FOUND');
  return n;
}

async function getRow(userId, id) {
  const row = await db.one('SELECT * FROM entries WHERE id = $1 AND user_id = $2', [entryId(id), userId]);
  if (!row) throw new AppError(404, 'NOT_FOUND');
  return row;
}

async function create(userId, dek, { date, data }) {
  const now = Date.now();
  const row = await db.one(
    'INSERT INTO entries (user_id, entry_date, data_enc, created_at, updated_at) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [userId, date, c.encryptJSON(dek, data, aad(userId)), now, now]
  );
  return decryptRow(row, dek);
}

async function update(userId, dek, id, { date, data }) {
  const row = await db.one(
    'UPDATE entries SET entry_date = $1, data_enc = $2, updated_at = $3 WHERE id = $4 AND user_id = $5 RETURNING *',
    [date, c.encryptJSON(dek, data, aad(userId)), Date.now(), entryId(id), userId]
  );
  if (!row) throw new AppError(404, 'NOT_FOUND');
  return decryptRow(row, dek);
}

function remove(userId, id) {
  return db.run('DELETE FROM entries WHERE id = $1 AND user_id = $2', [entryId(id), userId]);
}

function totals(list) {
  const t = { income: 0, expense: 0 };
  for (const e of list) t[e.type] += e.amount;
  t.income = Math.round(t.income * 100) / 100;
  t.expense = Math.round(t.expense * 100) / 100;
  t.net = Math.round((t.income - t.expense) * 100) / 100;
  t.count = list.length;
  return t;
}

module.exports = { validate, listByRange, toCurrency, currencyOfRow, getRow, create, update, remove, totals };
