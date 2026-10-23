'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // .env is optional
}

const isProd = process.env.NODE_ENV === 'production';
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// The server secret is mixed into every key derivation (as a "pepper").
// A stolen database without this secret is useless, even for weak passwords.
function loadSecret() {
  if (process.env.APP_SECRET) {
    const buf = Buffer.from(process.env.APP_SECRET, 'hex');
    if (buf.length < 32) throw new Error('APP_SECRET must be at least 64 hex characters');
    return buf;
  }
  const file = path.join(DATA_DIR, 'secret.key');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    console.warn(`[finance-baba] Generated a new server secret at ${file}. Back it up: losing it makes all data unreadable.`);
  }
  return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
}

module.exports = {
  ROOT,
  DATA_DIR,
  isProd,
  PORT: Number(process.env.PORT) || 3000,
  DB_PATH: process.env.DB_PATH || path.join(DATA_DIR, 'finance-baba.db'),
  SECRET: loadSecret(),
  TRUST_PROXY: process.env.TRUST_PROXY === '1',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  COOKIE_NAME: 'fb_sid',
  COOKIE_SECURE: isProd,
  SESSION_IDLE_MS: 30 * 60 * 1000, // logged out after 30 min of inactivity
  SESSION_MAX_MS: 12 * 60 * 60 * 1000, // and after 12 h at most
  UNLOCK_MS: 5 * 60 * 1000, // past-day editing stays unlocked for 5 min after entering the password
  MAX_FAILED_LOGINS: 5,
  LOCK_MS: 15 * 60 * 1000,
  WEEK_START: 6, // 0 = Sunday ... 6 = Saturday (common in Bangladesh)
  DEFAULT_TZ: 'Asia/Dhaka',
};
