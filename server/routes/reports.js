'use strict';
const express = require('express');
const users = require('../users');
const { AppError } = require('../errors');
const { isValidDate } = require('../dates');
const { summarize } = require('../reports/summary');
const { writeReport } = require('../reports/pdf');
const { context } = require('./entries');

const router = express.Router();

function parseQuery(req, allowed) {
  const ctx = context(req);
  const period = req.query.period;
  if (!allowed.includes(period)) throw new AppError(400, 'INVALID_PERIOD');
  const date = req.query.date || ctx.today;
  if (!isValidDate(date)) throw new AppError(400, 'INVALID_DATE');
  return { ctx, period, date };
}

router.get('/summary', (req, res) => {
  const { ctx, period, date } = parseQuery(req, ['week', 'month', 'year']);
  res.json(summarize(ctx, period, date));
});

router.get('/pdf', (req, res) => {
  const { ctx, period, date } = parseQuery(req, ['month', 'year']);
  const lang = req.query.lang === 'bn' ? 'bn' : 'en';
  const summary = summarize(ctx, period, date);
  const row = users.findById(ctx.userId);
  const name = period === 'year' ? summary.range.start.slice(0, 4) : summary.range.start.slice(0, 7);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="finance-baba-${name}.pdf"`);
  writeReport(res, { lang, summary, profile: users.getProfile(row, ctx.dek), publicId: row.public_id });
});

module.exports = router;
