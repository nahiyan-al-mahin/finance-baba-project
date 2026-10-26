'use strict';
/*
 * Live exchange rates (mid-market). Sources, in order:
 *   1. ExchangeRate-API open access  https://open.er-api.com   (free, no key, updated daily)
 *   2. Fawaz Ahmed's currency-api via jsDelivr                  (free, no key, updated daily)
 *   3. Approximate built-in rates from shared/currencies.js     (only if nothing was ever fetched)
 * Rates are cached in the database for 6 hours, so all server instances share them.
 */
const db = require('./db');
const CURRENCIES = require('../shared/currencies');

const TTL_MS = 6 * 60 * 60 * 1000;
const MEMORY_MS = 10 * 60 * 1000;
let memory = null; // { rates, updatedAt, source, fetchedAt }
let override = null; // tests

const pick = (all) => Object.fromEntries(CURRENCIES.codes.filter((c) => all[c] > 0).map((c) => [c, all[c]]));

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function fetchLive() {
  try {
    const j = await fetchJson('https://open.er-api.com/v6/latest/USD');
    if (j.result === 'success' && j.rates?.BDT) {
      return { rates: pick(j.rates), updatedAt: j.time_last_update_unix * 1000, source: 'ExchangeRate-API' };
    }
  } catch (err) {
    console.error('[finance-baba] Rates source 1 failed:', err.message);
  }
  const j = await fetchJson('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json');
  const upper = Object.fromEntries(Object.entries(j.usd || {}).map(([k, v]) => [k.toUpperCase(), v]));
  if (!upper.BDT) throw new Error('No BDT rate in fallback source');
  return { rates: pick({ ...upper, USD: 1 }), updatedAt: Date.parse(j.date) || Date.now(), source: 'currency-api (jsDelivr)' };
}

function builtIn() {
  return {
    rates: Object.fromEntries(CURRENCIES.list.map((c) => [c.code, c.fallback])),
    updatedAt: Date.parse(CURRENCIES.fallbackDate),
    source: 'approximate built-in rates',
    approximate: true,
  };
}

/** Units of each currency per 1 USD, plus when/where they came from. Never throws. */
async function getRates() {
  if (override) return override;
  if (memory && Date.now() - memory.fetchedAt < MEMORY_MS) return memory;
  const row = await db.one('SELECT data, fetched_at FROM fx_rates WHERE id = 1');
  let current = row ? { ...JSON.parse(row.data), fetchedAt: row.fetched_at } : null;
  if (!current || Date.now() - current.fetchedAt > TTL_MS) {
    try {
      const live = await fetchLive();
      current = { ...live, fetchedAt: Date.now() };
      await db.run(
        `INSERT INTO fx_rates (id, data, fetched_at) VALUES (1, $1, $2)
         ON CONFLICT (id) DO UPDATE SET data = $1, fetched_at = $2`,
        [JSON.stringify(live), current.fetchedAt]
      );
    } catch (err) {
      console.error('[finance-baba] Could not refresh exchange rates:', err.message);
      if (!current) current = { ...builtIn(), fetchedAt: Date.now() };
      else current.fetchedAt = Date.now() - TTL_MS + MEMORY_MS; // retry in a few minutes
    }
  }
  memory = { ...current, fetchedAt: Date.now() };
  return memory;
}

/** Converts between two supported currencies with the given rates (units per USD). */
function convert(amount, from, to, rates) {
  if (from === to) return amount;
  const a = rates.rates[from];
  const b = rates.rates[to];
  if (!a || !b) return amount;
  return (amount / a) * b;
}

module.exports = {
  getRates,
  convert,
  isSupported: (code) => CURRENCIES.codes.includes(code),
  DEFAULT: CURRENCIES.default,
  /** Tests: use fixed rates. */
  setRatesForTests(rates) {
    override = rates ? { rates, updatedAt: Date.now(), source: 'test' } : null;
  },
};
