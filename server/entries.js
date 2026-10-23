'use strict';
// Data access for finance entries. Everything except the date is encrypted with the user's DEK.
const db = require('./db');
const c = require('./crypto');
const CATEGORIES = require('../shared/categories');
const { AppError } = require('./errors');
const { isValidDate } = require('./dates');

const aad = (userId) => `entry:${userId}`;

function decryptRow(row, dek) {
  const data = c.decryptJSON(dek, row.data_enc, aad(row.user_id));
  return { id: row.id, date: row.entry_date, createdAt: row.created_at, updatedAt: row.updated_at, ...data };
}

function validate(body, today) {
  const { date, type, category } = body || {};
  if (!isValidDate(date)) throw new AppError(400, 'INVALID_DATE');
  if (date > today) throw new AppError(400, 'FUTURE_DATE');
  if (!['expense', 'income'].includes(type)) throw new AppError(400, 'INVALID_TYPE');
  if (!CATEGORIES[type].some((cat) => cat.id === category)) throw new AppError(400, 'INVALID_CATEGORY');
  const amount = Math.round(Number(body.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) throw new AppError(400, 'INVALID_AMOUNT');
  const note = String(body.note || '').trim();
  if (note.length < 1 || note.length > 200) throw new AppError(400, 'INVALID_NOTE');
  return { date, data: { type, amount, category, note } };
}

function listByRange(userId, dek, start, end) {
  return db
    .prepare('SELECT * FROM entries WHERE user_id = ? AND entry_date BETWEEN ? AND ? ORDER BY entry_date, created_at, id')
    .all(userId, start, end)
    .map((row) => decryptRow(row, dek));
}

function getRow(userId, id) {
  const row = db.prepare('SELECT * FROM entries WHERE id = ? AND user_id = ?').get(Number(id), userId);
  if (!row) throw new AppError(404, 'NOT_FOUND');
  return row;
}

function create(userId, dek, { date, data }) {
  const now = Date.now();
  const info = db
    .prepare('INSERT INTO entries (user_id, entry_date, data_enc, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, date, c.encryptJSON(dek, data, aad(userId)), now, now);
  return decryptRow(getRow(userId, info.lastInsertRowid), dek);
}

function update(userId, dek, id, { date, data }) {
  db.prepare('UPDATE entries SET entry_date = ?, data_enc = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(
    date,
    c.encryptJSON(dek, data, aad(userId)),
    Date.now(),
    Number(id),
    userId
  );
  return decryptRow(getRow(userId, id), dek);
}

function remove(userId, id) {
  db.prepare('DELETE FROM entries WHERE id = ? AND user_id = ?').run(Number(id), userId);
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

module.exports = { validate, listByRange, getRow, create, update, remove, totals };
