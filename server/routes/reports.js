'use strict';
const express = require('express');
const users = require('../users');
const { AppError } = require('../errors');
const { isValidDate } = require('../dates');
const { summarize } = require('../reports/summary');
const { writeReport } = require('../reports/pdf');
const { context } = require('./entries');
const targets = require('../targets');

const router = express.Router();

async function parseQuery(req, allowed) {
  const ctx = await context(req);
  const period = req.query.period;
  if (!allowed.includes(period)) throw new AppError(400, 'INVALID_PERIOD');
  const date = req.query.date || ctx.today;
  if (!isValidDate(date)) throw new AppError(400, 'INVALID_DATE');
  return { ctx, period, date };
}

router.get('/summary', async (req, res) => {
  const { ctx, period, date } = await parseQuery(req, ['week', 'month', 'year']);
  res.json(await summarize(ctx, period, date));
});

router.get('/pdf', async (req, res) => {
  const { ctx, period, date } = await parseQuery(req, ['month', 'year']);
  const lang = req.query.lang === 'bn' ? 'bn' : 'en';
  const summary = await summarize(ctx, period, date);
  const row = await users.findById(ctx.userId);
  const name = period === 'year' ? summary.range.start.slice(0, 4) : summary.range.start.slice(0, 7);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="finance-baba-${name}.pdf"`);
  const target = period === 'month' ? await targets.read(ctx.userId, ctx.dek, summary.range.start.slice(0, 7)) : null;
  writeReport(res, { lang, summary, profile: users.getProfile(row, ctx.dek), publicId: row.public_id, target: target?.amount });
});

module.exports = router;
