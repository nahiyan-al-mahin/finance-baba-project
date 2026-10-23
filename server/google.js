'use strict';
// "Sign in with Google" (works for any Gmail / Google account).
// The browser gets an ID token from Google Identity Services; we verify it here.
const { OAuth2Client } = require('google-auth-library');
const { GOOGLE_CLIENT_ID } = require('./config');
const { AppError } = require('./errors');
const { randomToken } = require('./crypto');

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
// past days and is the fallback login). Between the two steps we remember the verified identity.
const pending = new Map();
const PENDING_MS = 15 * 60 * 1000;

function rememberPending(identity) {
  const token = randomToken(24);
  pending.set(token, { ...identity, expires: Date.now() + PENDING_MS });
  return token;
}

function getPending(token) {
  const p = pending.get(String(token || ''));
  if (!p || p.expires < Date.now()) throw new AppError(401, 'GOOGLE_EXPIRED');
  return p;
}

const dropPending = (token) => pending.delete(String(token || ''));

setInterval(() => {
  const now = Date.now();
  for (const [k, p] of pending) if (p.expires < now) pending.delete(k);
}, 60 * 1000).unref();

module.exports = { google, rememberPending, getPending, dropPending };
