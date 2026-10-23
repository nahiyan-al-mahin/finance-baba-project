'use strict';
// express-rate-limit store backed by Postgres, so limits hold across all serverless instances.
const db = require('./db');

class PgStore {
  constructor(prefix) {
    this.prefix = `${prefix}:`;
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(key) {
    const now = Date.now();
    const row = await db.one(
      `INSERT INTO rate_limits (key, hits, reset_at) VALUES ($1, 1, $2)
       ON CONFLICT (key) DO UPDATE SET
         hits     = CASE WHEN rate_limits.reset_at <= $3 THEN 1 ELSE rate_limits.hits + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at <= $3 THEN $2 ELSE rate_limits.reset_at END
       RETURNING hits, reset_at`,
      [this.prefix + key, now + this.windowMs, now]
    );
    if (Math.random() < 0.01) await db.run('DELETE FROM rate_limits WHERE reset_at <= $1', [now]);
    return { totalHits: row.hits, resetTime: new Date(row.reset_at) };
  }

  async decrement(key) {
    await db.run('UPDATE rate_limits SET hits = GREATEST(hits - 1, 0) WHERE key = $1', [this.prefix + key]);
  }

  async resetKey(key) {
    await db.run('DELETE FROM rate_limits WHERE key = $1', [this.prefix + key]);
  }
}

module.exports = { PgStore };
