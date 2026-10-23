'use strict';
// All dates are plain 'YYYY-MM-DD' strings; arithmetic is done in UTC to avoid DST surprises.
const { WEEK_START, DEFAULT_TZ } = require('./config');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidTimezone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function todayIn(tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: isValidTimezone(tz) ? tz : DEFAULT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date());
}

const parse = (str) => new Date(`${str}T00:00:00Z`);
const format = (d) => d.toISOString().slice(0, 10);

function isValidDate(str) {
  return typeof str === 'string' && DATE_RE.test(str) && format(parse(str)) === str;
}

function addDays(str, n) {
  const d = parse(str);
  d.setUTCDate(d.getUTCDate() + n);
  return format(d);
}

function lastDayOfMonth(year, month /* 1-12 */) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function periodRange(period, anchor) {
  const [y, m] = anchor.split('-').map(Number);
  if (period === 'week') {
    const diff = (parse(anchor).getUTCDay() - WEEK_START + 7) % 7;
    const start = addDays(anchor, -diff);
    return { start, end: addDays(start, 6) };
  }
  if (period === 'month') {
    const mm = String(m).padStart(2, '0');
    return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(lastDayOfMonth(y, m)).padStart(2, '0')}` };
  }
  if (period === 'year') return { start: `${y}-01-01`, end: `${y}-12-31` };
  throw new Error(`Unknown period ${period}`);
}

/** An anchor date inside the period just before the one containing `anchor`. */
function previousAnchor(period, anchor) {
  const { start } = periodRange(period, anchor);
  if (period === 'week') return addDays(start, -7);
  if (period === 'month') return addDays(start, -1);
  return `${Number(anchor.slice(0, 4)) - 1}-01-01`;
}

function eachDay(start, end) {
  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

module.exports = { isValidTimezone, todayIn, isValidDate, addDays, periodRange, previousAnchor, eachDay, parse };
