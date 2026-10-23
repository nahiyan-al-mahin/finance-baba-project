'use strict';
/*
 * Encryption model
 * ----------------
 * - Every user gets a random 256-bit Data Encryption Key (DEK).
 * - All finance data (amounts, categories, notes) and the profile are encrypted
 *   with the DEK using AES-256-GCM.
 * - The DEK is stored only "wrapped" (encrypted) with a Key Encryption Key (KEK)
 *   derived from the user's password: scrypt(password) -> HKDF(with server secret).
 * - A second copy of the DEK is wrapped with a key derived from a one-time
 *   recovery code, so a forgotten password does not mean lost data.
 * - The password itself is never stored; only an HKDF-derived verifier.
 * - Accounts linked to Google keep a third copy wrapped with a server-held key, because a
 *   Google sign-in carries no password to derive a key from. A stolen database alone still
 *   reveals nothing; the attacker would also need the server secret.
 * - The unwrapped DEK lives only in server memory for the session's lifetime.
 */
const crypto = require('crypto');
const { SECRET } = require('./config');

const SCRYPT_OPTS = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SERVER_DATA_KEY = Buffer.from(crypto.hkdfSync('sha256', SECRET, Buffer.alloc(0), 'finance-baba:server-data', 32));
const GOOGLE_WRAP_KEY = Buffer.from(crypto.hkdfSync('sha256', SECRET, Buffer.alloc(0), 'finance-baba:google-wrap', 32));

const b64 = (buf) => buf.toString('base64');
const unb64 = (str) => Buffer.from(str, 'base64');

function scryptAsync(secret, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(secret).normalize('NFKC'), salt, 32, SCRYPT_OPTS, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Returns { authHash, kek } — a password verifier and a key-encryption key. */
async function deriveKeys(secret, salt, purpose) {
  const stretched = await scryptAsync(secret, salt);
  const okm = Buffer.from(crypto.hkdfSync('sha256', stretched, SECRET, `finance-baba:${purpose}`, 64));
  return { authHash: okm.subarray(0, 32), kek: okm.subarray(32) };
}

const newSalt = () => crypto.randomBytes(16);
const newKey = () => crypto.randomBytes(32);
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

function encrypt(key, data, aad = '') {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(data), cipher.final()]);
  return `${b64(iv)}.${b64(cipher.getAuthTag())}.${b64(ct)}`;
}

function decrypt(key, payload, aad = '') {
  const [iv, tag, ct] = String(payload).split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, unb64(iv));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(unb64(tag));
  return Buffer.concat([decipher.update(unb64(ct)), decipher.final()]);
}

const encryptJSON = (key, obj, aad) => encrypt(key, Buffer.from(JSON.stringify(obj)), aad);
const decryptJSON = (key, payload, aad) => JSON.parse(decrypt(key, payload, aad).toString('utf8'));

/** Server-key encryption for data that is not tied to a user's password (e.g. admin warnings). */
const serverEncrypt = (text, aad) => encrypt(SERVER_DATA_KEY, Buffer.from(text), aad);
const serverDecrypt = (payload, aad) => decrypt(SERVER_DATA_KEY, payload, aad).toString('utf8');

/** Wraps / unwraps a user's DEK for Google sign-in. */
const wrapForGoogle = (dek, aad) => encrypt(GOOGLE_WRAP_KEY, dek, aad);
const unwrapForGoogle = (payload, aad) => decrypt(GOOGLE_WRAP_KEY, payload, aad);

/** Keyed hash so usernames can be looked up without being stored in plain text. */
const blindIndex = (value) => crypto.createHmac('sha256', SECRET).update(value).digest('hex');

function safeEqual(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateRecoveryCode() {
  const bytes = crypto.randomBytes(20);
  let out = '';
  for (let i = 0; i < 20; i++) {
    if (i && i % 5 === 0) out += '-';
    out += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
  }
  return out;
}
const normalizeRecoveryCode = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

module.exports = {
  b64,
  unb64,
  deriveKeys,
  newSalt,
  newKey,
  randomToken,
  encrypt,
  decrypt,
  encryptJSON,
  decryptJSON,
  serverEncrypt,
  serverDecrypt,
  wrapForGoogle,
  unwrapForGoogle,
  blindIndex,
  safeEqual,
  generateRecoveryCode,
  normalizeRecoveryCode,
};
