'use strict';
const { periodRange, previousAnchor, eachDay } = require('../dates');
const entries = require('../entries');
const ledger = require('../ledger');
const quietDays = require('../quietDays');

const round = (n) => Math.round(n * 100) / 100;

function breakdown(list, type) {
  const map = new Map();
  for (const e of list) if (e.type === type) map.set(e.category, (map.get(e.category) || 0) + e.amount);
  const total = [...map.values()].reduce((a, b) => a + b, 0);
  return [...map.entries()]
    .map(([category, amount]) => ({ category, amount: round(amount), pct: total ? round((amount / total) * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

function series(list, period, range) {
  const keys =
    period === 'year'
      ? Array.from({ length: 12 }, (_, i) => `${range.start.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`)
      : eachDay(range.start, range.end);
  const buckets = new Map(keys.map((k) => [k, { key: k, income: 0, expense: 0, count: 0 }]));
  for (const e of list) {
    const b = buckets.get(period === 'year' ? e.date.slice(0, 7) : e.date);
    b[e.type] += e.amount;
    b.count++;
  }
  return [...buckets.values()].map((b) => ({ ...b, income: round(b.income), expense: round(b.expense) }));
}

/** Days of the period that have actually happened (for "average per day"). */
function elapsedDays(range, today) {
  if (today < range.start) return 0;
  const end = today < range.end ? today : range.end;
  return eachDay(range.start, end).length;
}

async function summarize(ctx, period, anchor) {
  const { userId, dek, today, money = null, currencyHistory = [] } = ctx;
  const range = periodRange(period, anchor);
  const list = await entries.listByRange(userId, dek, range.start, range.end, money);
  const prevRange = periodRange(period, previousAnchor(period, anchor));
  const prevTotals = entries.totals(await entries.listByRange(userId, dek, prevRange.start, prevRange.end, money));
  const totals = entries.totals(list);
  const days = elapsedDays(range, today);
  const expenses = list.filter((e) => e.type === 'expense');
  const biggest = expenses.reduce((max, e) => (!max || e.amount > max.amount ? e : max), null);
  const s = series(list, period, range);
  // Days marked "no income or expense" count for the logging streak and get their own calendar mark.
  if (period !== 'year') {
    const quiet = await quietDays.inRange(userId, range.start, range.end);
    for (const b of s) if (!b.count && quiet.has(b.key)) b.quiet = true;
  }
  const busiest = s.filter((b) => b.expense > 0).sort((a, b) => b.expense - a.expense)[0] || null;
  const savings = await ledger.savingsForRange(ctx, range.start, range.end);
  const loans = await ledger.loansForReport(ctx, range.end);

  return {
    currency: money ? money.currency : 'BDT',
    // Currency changes up to the end of this period, so reports can say when the currency changed.
    currencyChanges: currencyHistory.filter((h) => h.date <= range.end),
    ratesSource: money && money.rates ? { source: money.rates.source, updatedAt: money.rates.updatedAt, approximate: !!money.rates.approximate } : null,
    period,
    range,
    today,
    totals,
    previous: { range: prevRange, totals: prevTotals },
    expenseChangePct: prevTotals.expense ? round(((totals.expense - prevTotals.expense) / prevTotals.expense) * 100) : null,
    avgDailyExpense: days ? round(totals.expense / days) : 0,
    savingsRatePct: totals.income ? round((totals.net / totals.income) * 100) : null,
    expenseByCategory: breakdown(list, 'expense'),
    incomeByCategory: breakdown(list, 'income'),
    series: s,
    biggestExpense: biggest,
    busiestBucket: busiest,
    entries: list,
    savings,
    loans: {
      owe: loans.owe,
      owed: loans.owed,
      open: loans.open.map((l) => ({ direction: l.direction, person: l.person, date: l.date, dueDate: l.dueDate, remaining: l.remainingAtEnd })),
    },
  };
}

module.exports = { summarize };
