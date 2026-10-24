'use strict';
// Email address, monthly email reports, language, and the monthly spending target.
const express = require('express');
const db = require('../db');
const users = require('../users');
const account = require('../account');
const targets = require('../targets');
const { AppError } = require('../errors');
const { context } = require('./entries');

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
