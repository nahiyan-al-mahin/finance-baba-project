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
const onVercel = !!process.env.VERCEL;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');

/** Local data folder (PGlite database, generated secret). Created on first use only. */
function dataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  return DATA_DIR;
}

// The server secret is mixed into every key derivation (as a "pepper").
// A stolen database without this secret is useless, even for weak passwords.
function loadSecret() {
  if (process.env.APP_SECRET) {
    const buf = Buffer.from(process.env.APP_SECRET, 'hex');
    if (buf.length < 32) throw new Error('APP_SECRET must be at least 64 hex characters');
    return buf;
  }
  if (onVercel || process.env.DATABASE_URL) {
    throw new Error('APP_SECRET is not set. Add it to your environment variables (see README → Deploying).');
  }
  const file = path.join(dataDir(), 'secret.key');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    console.warn(`[finance-baba] Generated a new server secret at ${file}. Back it up: losing it makes all data unreadable.`);
  }
  return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
}

module.exports = {
  ROOT,
  DATA_DIR,
  dataDir,
  isProd,
  onVercel,
  PORT: Number(process.env.PORT) || 3000,
  DATABASE_URL: process.env.DATABASE_URL || '',
  SECRET: loadSecret(),
  TRUST_PROXY: process.env.TRUST_PROXY === '1' || onVercel,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  // Email (SMTP). Gmail works with an App Password: smtp.gmail.com, port 465.
  SMTP: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 465,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
  MAIL_FROM: process.env.MAIL_FROM || process.env.SMTP_USER || '',
  MAIL_LOG: process.env.MAIL_LOG === '1', // development: print emails to the console instead of sending
  APP_URL: (process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000')).replace(/\/$/, ''),
  CRON_SECRET: process.env.CRON_SECRET || '',
  TARGET_EDIT_DAYS: 3, // the monthly target can be set or changed on days 1-3 of the month
  COOKIE_NAME: 'fb_sid',
  COOKIE_SECURE: isProd || onVercel,
  SESSION_IDLE_MS: 30 * 60 * 1000, // logged out after 30 min of inactivity
  SESSION_MAX_MS: 12 * 60 * 60 * 1000, // and after 12 h at most
  UNLOCK_MS: 5 * 60 * 1000, // past-day editing stays unlocked for 5 min after entering the password
  MAX_FAILED_LOGINS: 5,
  AUTH_RATE_LIMIT: Number(process.env.AUTH_RATE_LIMIT) || 30, // sign-in/sign-up requests per IP per 15 min
  LOCK_MS: 15 * 60 * 1000,
  WEEK_START: 6, // 0 = Sunday ... 6 = Saturday (common in Bangladesh)
  DEFAULT_TZ: 'Asia/Dhaka',
};
