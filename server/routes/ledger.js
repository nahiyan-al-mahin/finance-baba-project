'use strict';
// Loans (/api/loans) and savings (/api/savings). Changes dated before today need the password, like entries.
const express = require('express');
const ledger = require('../ledger');
const { context, assertCanModify } = require('./entries');

const loans = express.Router();

loans.get('/', async (req, res) => {
  res.json(await ledger.listLoans(await context(req)));
});

loans.post('/', async (req, res) => {
  const ctx = await context(req);
  if (req.body?.date) await assertCanModify(req, ctx, String(req.body.date));
  res.status(201).json({ loan: await ledger.createLoan(ctx, req.body) });
});

loans.put('/:id', async (req, res) => {
  const ctx = await context(req);
  await assertCanModify(req, ctx, ...(await ledger.loanDates(ctx, req.params.id)), String(req.body?.date || ctx.today));
  res.json({ loan: (await ledger.updateLoan(ctx, req.params.id, req.body)).loan });
});

// Repayment: { amount, date, note } or { full: true, date } to settle what is left.
loans.post('/:id/payments', async (req, res) => {
  const ctx = await context(req);
  await ledger.loanDates(ctx, req.params.id); // 404 before asking for a password
  if (req.body?.date) await assertCanModify(req, ctx, String(req.body.date));
  res.status(201).json({ loan: (await ledger.addPayment(ctx, req.params.id, req.body)).loan });
});

loans.delete('/:id/payments/:paymentId', async (req, res) => {
  const ctx = await context(req);
  await assertCanModify(req, ctx, ...(await ledger.loanDates(ctx, req.params.id)));
  res.json({ loan: (await ledger.removePayment(ctx, req.params.id, String(req.params.paymentId))).loan });
});

loans.delete('/:id', async (req, res) => {
  const ctx = await context(req);
  await assertCanModify(req, ctx, ...(await ledger.loanDates(ctx, req.params.id)));
  await ledger.removeLoan(ctx, req.params.id);
  res.json({ ok: true });
});

const savings = express.Router();

savings.get('/', async (req, res) => {
  res.json(await ledger.savingsSummary(await context(req)));
});

savings.post('/', async (req, res) => {
  const ctx = await context(req);
  if (req.body?.date) await assertCanModify(req, ctx, String(req.body.date));
  const log = await ledger.addSaving(ctx, req.body);
  res.status(201).json({ log, summary: await ledger.savingsSummary(ctx) });
});

savings.delete('/:id', async (req, res) => {
  const ctx = await context(req);
  await assertCanModify(req, ctx, await ledger.savingDate(ctx, req.params.id));
  await ledger.removeSaving(ctx, req.params.id);
  res.json({ ok: true, summary: await ledger.savingsSummary(ctx) });
});

module.exports = { loansRouter: loans, savingsRouter: savings };
