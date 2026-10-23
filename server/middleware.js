'use strict';
const db = require('./db');
const sessions = require('./sessions');
const { COOKIE_NAME, COOKIE_SECURE, SESSION_MAX_MS } = require('./config');

const cookieOptions = { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'strict', path: '/', maxAge: SESSION_MAX_MS };

function loadSession(req, res, next) {
  const sid = req.cookies[COOKIE_NAME];
  const s = sessions.get(sid);
  if (s) {
    req.session = s;
    req.sid = sid;
    // Throttled "last active" for the admin overview.
    if (!s.lastActiveWrite || Date.now() - s.lastActiveWrite > 5 * 60 * 1000) {
      s.lastActiveWrite = Date.now();
      db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(Date.now(), s.userId);
    }
  }
  next();
}

// SameSite=strict cookies already block cross-site requests; this header check is a second layer
// (cross-origin pages cannot set custom headers without a CORS preflight, which we never allow).
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'FinanceBaba') return res.status(403).json({ error: 'CSRF' });
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    if (role && req.session.role !== role) return res.status(403).json({ error: 'FORBIDDEN' });
    next();
  };
}

function startSession(res, user, dek) {
  res.cookie(COOKIE_NAME, sessions.create(user, dek), cookieOptions);
}

function endSession(req, res) {
  if (req.sid) sessions.destroy(req.sid);
  res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: undefined });
}

module.exports = {
  loadSession,
  csrfGuard,
  requireAuth: requireRole(null),
  requireUser: requireRole('user'),
  requireAdmin: requireRole('admin'),
  startSession,
  endSession,
};
