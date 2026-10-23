'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { AppError } = require('./errors');
const { loadSession, csrfGuard, requireUser, requireAdmin } = require('./middleware');
const authRoutes = require('./routes/auth');
const { entriesRouter, warningsRouter } = require('./routes/entries');
const reportRoutes = require('./routes/reports');
const adminRoutes = require('./routes/admin');

// Google Identity Services ("Continue with Google")
const GSI = 'https://accounts.google.com/gsi/';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.TRUST_PROXY ? 1 : false);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", GSI],
        styleSrc: ["'self'", "'unsafe-inline'", GSI], // Chart.js sets inline styles on its canvas
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'", GSI],
        frameSrc: [GSI],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
    // Google's sign-in popup needs these two relaxed from helmet's defaults.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })
);

// ---- API
const api = express.Router();
api.use(rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'TOO_MANY_REQUESTS' } }));
api.use(express.json({ limit: '20kb' }));
api.get('/health', (req, res) => res.json({ ok: true })); // for hosting platforms' health checks
api.use(cookieParser());
api.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
api.use(loadSession);
api.use(csrfGuard);
api.use('/auth', authRoutes);
api.use('/entries', requireUser, entriesRouter);
api.use('/warnings', requireUser, warningsRouter);
api.use('/reports', requireUser, reportRoutes);
api.use('/admin', requireAdmin, adminRoutes);
api.use((req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
app.use('/api', api);

// ---- Static files
app.use('/vendor/chart.js', express.static(path.join(config.ROOT, 'node_modules', 'chart.js', 'dist'), { maxAge: '7d' }));
app.use('/shared', express.static(path.join(config.ROOT, 'shared')));
app.use(express.static(path.join(config.ROOT, 'public'), { extensions: ['html'] }));

// ---- Errors
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof AppError) return res.status(err.status).json({ error: err.code, ...err.extra });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'BAD_JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'TOO_LARGE' });
  console.error(err);
  res.status(500).json({ error: 'SERVER_ERROR' });
});

/**
 * On hosts without a terminal, set ADMIN_USERNAME + ADMIN_PASSWORD once: the admin account is
 * created at start-up if it does not exist yet. Remove ADMIN_PASSWORD afterwards.
 */
async function ensureAdminFromEnv() {
  const { ADMIN_USERNAME, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) return;
  const users = require('./users');
  if (users.findByUsername(ADMIN_USERNAME)) return;
  try {
    await users.createUser({ username: ADMIN_USERNAME, displayName: 'Admin', password: ADMIN_PASSWORD, timezone: config.DEFAULT_TZ, role: 'admin' });
    console.log(`[finance-baba] Admin "${users.normalizeUsername(ADMIN_USERNAME)}" created. You can now remove ADMIN_PASSWORD.`);
  } catch (err) {
    console.error(`[finance-baba] Could not create admin from env: ${err.code || err.message}`);
  }
}

if (require.main === module) {
  ensureAdminFromEnv().then(() =>
    app.listen(config.PORT, () => console.log(`Finance Baba running at http://localhost:${config.PORT}`))
  );
}

module.exports = app;
