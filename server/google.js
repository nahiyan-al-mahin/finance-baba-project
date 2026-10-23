'use strict';
// "Sign in with Google" (works for any Gmail / Google account).
// The browser gets an ID token from Google Identity Services; we verify it here.
const { OAuth2Client } = require('google-auth-library');
const { GOOGLE_CLIENT_ID } = require('./config');
const { AppError } = require('./errors');
const crypto = require('crypto');
const db = require('./db');
const { randomToken, serverEncrypt, serverDecrypt } = require('./crypto');

const client = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

const google = {
  enabled: () => !!client,

  /** Returns { sub, email, name } for a valid, verified Google ID token. Replaceable in tests. */
  async verify(credential) {
    if (!client) throw new AppError(404, 'GOOGLE_DISABLED');
    let payload;
    try {
      const ticket = await client.verifyIdToken({ idToken: String(credential || ''), audience: GOOGLE_CLIENT_ID });
      payload = ticket.getPayload();
    } catch {
      throw new AppError(401, 'GOOGLE_INVALID');
    }
    if (!payload?.sub || !payload.email_verified) throw new AppError(401, 'GOOGLE_INVALID');
    return { sub: payload.sub, email: payload.email, name: payload.name || '' };
  },
};

// A brand-new Google user still has to pick a username and password (the password protects
// past days and is the fallback login). Between the two steps we remember the verified identity
// in the database (encrypted), keyed by a hash of a one-time token held by the browser.
const PENDING_MS = 15 * 60 * 1000;
const tokenHash = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex');

async function rememberPending(identity) {
  const token = randomToken(24);
  const hash = tokenHash(token);
  await db.run('DELETE FROM google_pending WHERE expires_at < $1', [Date.now()]);
  await db.run('INSERT INTO google_pending (token_hash, data_enc, expires_at) VALUES ($1, $2, $3)', [
    hash,
    serverEncrypt(JSON.stringify(identity), `google-pending:${hash}`),
    Date.now() + PENDING_MS,
  ]);
  return token;
}

async function getPending(token) {
  const hash = tokenHash(token);
  const row = await db.one('SELECT * FROM google_pending WHERE token_hash = $1', [hash]);
  if (!row || row.expires_at < Date.now()) throw new AppError(401, 'GOOGLE_EXPIRED');
  return JSON.parse(serverDecrypt(row.data_enc, `google-pending:${hash}`));
}

const dropPending = (token) => db.run('DELETE FROM google_pending WHERE token_hash = $1', [tokenHash(token)]);

module.exports = { google, rememberPending, getPending, dropPending };
