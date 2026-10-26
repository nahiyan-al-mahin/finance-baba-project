'use strict';
// Email address, monthly email reports, language, and the monthly spending target.
const express = require('express');
const db = require('../db');
const users = require('../users');
const account = require('../account');
const targets = require('../targets');
const { AppError } = require('../errors');
const { context } = require('./entries');
const rates = require('../rates');
const { todayIn } = require('../dates');

const router = express.Router();

async function currentRow(req) {
  const row = await users.findById(req.session.userId);
  if (!row) throw new AppError(401, 'UNAUTHENTICATED');
  return row;
}

// ---- Email
router.post('/email', async (req, res) => {
  const row = await currentRow(req);
  const name = users.getProfile(row, req.session.dek).displayName;
  const pending = await account.startVerification(row, req.body?.email, { name, lang: row.lang });
  res.json({ pendingEmail: pending });
});

router.post('/email/verify', async (req, res) => {
  const row = await currentRow(req);
  await account.confirm(row, req.body?.code);
  res.json({ user: users.toPublic(await users.findById(row.id), req.session.dek) });
});

// ---- Monthly email reports on/off
router.put('/reports', async (req, res) => {
  const row = await currentRow(req);
  if (row.role !== 'user') throw new AppError(403, 'FORBIDDEN');
  await users.setReports(row, req.session.dek, !!req.body?.enabled);
  res.json({ user: users.toPublic(await users.findById(row.id), req.session.dek) });
});

// ---- Language used for emails and PDF reports
router.put('/lang', async (req, res) => {
  const lang = req.body?.lang === 'bn' ? 'bn' : 'en';
  await db.run('UPDATE users SET lang = $1 WHERE id = $2', [lang, req.session.userId]);
  res.json({ lang });
});

// ---- Currency. Entries are saved in the currency chosen at the time; the change is recorded with its date for reports.
router.put('/currency', async (req, res) => {
  const code = String(req.body?.currency || '').toUpperCase();
  if (!rates.isSupported(code)) throw new AppError(400, 'INVALID_CURRENCY');
  const row = await currentRow(req);
  const profile = users.getProfile(row, req.session.dek);
  const { currency, history } = users.currencyOf(profile);
  if (code !== currency) {
    const date = todayIn(row.timezone);
    // Several changes on one day collapse into a single "from → to" line.
    const kept = history.filter((h) => h.date !== date);
    const sameDay = history.find((h) => h.date === date);
    const from = sameDay ? sameDay.from : currency;
    const next = from === code ? kept : [...kept, { date, from, to: code }];
    await users.updateProfile(row, req.session.dek, { ...profile, currency: code, currencyHistory: next.slice(-50) });
  }
  res.json({ user: users.toPublic(await users.findById(row.id), req.session.dek) });
});

// ---- Live exchange rates, expressed as Taka per one unit of each currency
router.get('/fx', async (req, res) => {
  const r = await rates.getRates();
  const bdtPer = Object.fromEntries(Object.keys(r.rates).map((code) => [code, rates.convert(1, code, 'BDT', r)]));
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.json({ base: 'BDT', bdtPer, updatedAt: r.updatedAt, source: r.source, approximate: !!r.approximate });
});

// ---- Monthly spending target
router.get('/target', async (req, res) => {
  res.json(await targets.status(await context(req)));
});

router.put('/target', async (req, res) => {
  res.json(await targets.set(await context(req), req.body?.amount));
});

router.delete('/target', async (req, res) => {
  res.json(await targets.remove(await context(req)));
});

module.exports = router;
