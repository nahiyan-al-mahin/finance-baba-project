# Finance Baba (ফাইন্যান্স বাবা)

A mobile-friendly personal finance diary. Users log what they spend and what they earn each day. The app shows the daily total, analyses each week, month and year, and exports full PDF statements. It works in **English and বাংলা**, with three themes: **light cream (default)**, **dark** and a hand-drawn **sketchbook** theme.

## Features

| Area | What it does |
| --- | --- |
| Accounts | Sign up / log in with a username and password, or **Continue with Google** (any Gmail account). A one-time **recovery code** resets a forgotten password without losing data. |
| Daily log | Choose expense or income, write what it was for, then enter the amount and category. The day's total spending is always shown. |
| Past days locked | Adding, editing or deleting entries on a day that has passed needs the password again. Editing then stays unlocked for 5 minutes. |
| Analysis | Week (Saturday to Friday), month and year views with charts, category breakdown, comparison with the previous period, savings rate and insights. |
| PDF | Monthly and yearly statements with summary, category bars, day-by-day or month-by-month totals and every transaction, in English or Bangla. |
| Onboarding | A "what is what" slide tour after the first sign-up (swipe on phones). It can be replayed from Settings. |
| Privacy | Users see only their own data. Admins see **only counts and anonymous activity signals** and can send warnings that the user must acknowledge. |
| Mobile | Responsive layout, bottom navigation on phones, safe-area support and an installable web-app manifest. |

## Tech stack

The parts you already know: **HTML, CSS and vanilla JavaScript** in the browser, and **Node.js** on the server. A few small, well-known additions:

| Added | Why |
| --- | --- |
| **Express 5** | The standard, minimal Node web framework for routes and middleware. |
| **PostgreSQL** (`pg`, hosted on **Neon**) | The database. Locally, without `DATABASE_URL`, the same SQL runs on **PGlite** (Postgres inside Node), so there is nothing to install. |
| Node's built-in **`crypto`** | scrypt password hashing and AES-256-GCM encryption, with no extra crypto dependencies. |
| **Chart.js** | Charts on the reports page, served locally rather than from a CDN. |
| **google-auth-library** | Verifies "Continue with Google" sign-ins on the server (Google's official library). |
| **PDFKit** | Generates PDFs on the server. The bundled Noto Sans Bengali font renders Bangla correctly. |
| **helmet** and **express-rate-limit** | Security headers (a strict CSP) and brute-force protection. |

No frontend framework or build step is involved: edit a file and refresh the page.

## How the encryption works

Even a full copy of the database is useless to an attacker:

1. Each user has a random 256-bit **data key**. Every amount, category, note and name is encrypted with it using **AES-256-GCM**. Only entry dates are stored in plain text, because date-range queries need them.
2. The data key is stored only in **wrapped** (encrypted) form. The wrapping key comes from the user's password: **scrypt**, then **HKDF** mixed with a server secret. A second wrapped copy uses the recovery code.
3. Passwords are never stored. Only a derived verifier is kept.
4. Usernames are stored as a keyed hash (HMAC), so they cannot be read either.
5. **Google sign-in.** A Google login carries no password to derive a key from. So an account linked to Google keeps one more wrapped copy of its data key, encrypted with a key that comes from the server secret. A stolen database alone still reveals nothing. Someone who steals the database **and** the server secret could, however, read Google-linked accounts, while password-only accounts stay protected by their passwords. Users who want the strictest protection can leave Google disconnected (Settings → Google account).
6. While a user is logged in, their data key is kept in the `sessions` table **encrypted with a key derived from the random token in their cookie**. The database only stores a hash of that token, so it cannot unlock the key on its own. Sessions end after 30 minutes idle or 12 hours.
7. Cookies are `HttpOnly` and `SameSite=Strict`, with a CSRF header check, a strict Content-Security-Policy and account lockout after 5 wrong passwords.

> ⚠️ **Keep `APP_SECRET` safe** (or `data/secret.key` when running locally without it). Without it, nothing in the database can be decrypted. Users who lose both their password and their recovery code cannot get their data back. That is by design.

## Getting started

```bash
npm install
cp .env.example .env          # optional; a secret is auto-generated if APP_SECRET is empty
npm start                     # http://localhost:3000
npm run dev                   # same, but restarts on file changes
```

Create an admin account, either by setting `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env` (created on the next start), or with the command below while the server is **stopped** (it asks for the password):

```bash
npm run create-admin -- admin "Site Admin"
```

Admins log in on the normal login page and are sent to `/admin`.

### Enabling "Continue with Google"

1. Open the [Google Cloud Console](https://console.cloud.google.com/apis/credentials) and go to **Create credentials → OAuth client ID → Web application**.
2. Under **Authorized JavaScript origins**, add your sites, e.g. `http://localhost:3000` and `https://your-app.vercel.app`.
3. Put the client ID in `.env` (and in Vercel's environment variables) as `GOOGLE_CLIENT_ID=...apps.googleusercontent.com` and restart / redeploy.

The Google button appears only when `GOOGLE_CLIENT_ID` is set. First-time Google users still choose a username and password: the password protects past days and works as a fallback login. Existing users can connect or disconnect Google under **Settings**.

Run the tests:

```bash
npm test
```

To test on your phone, run the server and open `http://<your-computer-ip>:3000` on the same Wi-Fi.

## Project structure

```
server/
  config.js           Settings and server secret
  crypto.js           Key derivation, AES-GCM, recovery codes
  app.js              Express app (shared by local server and Vercel)
  index.js            Local entry point (`npm start`)
  db.js               Postgres schema and queries (Neon via pg, or local PGlite)
  bootstrap.js        Creates the admin from ADMIN_USERNAME/ADMIN_PASSWORD
  rateLimitStore.js   Rate limits stored in Postgres
  users.js            Sign-up, login, lockout, password change, recovery, Google linking
  google.js           Google ID-token verification
  sessions.js         Database sessions (data key encrypted with the cookie token)
  entries.js          Encrypted entry storage and validation
  dates.js            Date helpers in the user's time zone
  routes/             auth, entries (+ warnings), reports, admin
  reports/            summary (analysis) and pdf (PDFKit statement)
shared/categories.js  Categories with English and Bangla labels (browser + server)
public/               index.html (login), app.html (user app), admin.html
  css/style.css       Light and dark themes, responsive layout
  js/                 i18n, api, ui helpers, app, reports, onboarding, admin
scripts/create-admin.js
test/api.test.js
```

## Deploying (Vercel + Neon, free)

The app runs as a Vercel serverless function (`api/index.js` → `server/app.js`) and stores everything in **Neon Postgres**. Pages, CSS and JS are served from Vercel's CDN (`public/`). Every push to GitHub redeploys automatically.

| Variable (Vercel → Settings → Environment Variables) | Value |
| --- | --- |
| `DATABASE_URL` | Neon **pooled** connection string |
| `APP_SECRET` | 64 hex chars, `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Keep a copy safe**: without it the data can never be decrypted. |
| `NODE_ENV` | `production` |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | optional: creates the first admin on the first request. Remove `ADMIN_PASSWORD` afterwards. |
| `GOOGLE_CLIENT_ID` | optional: enables Continue with Google |

Steps:

1. **Neon** → New project (region: Singapore) → *Connect* → copy the **pooled** connection string.
2. **Vercel** → Add New → Project → import `finance-baba-project` (choose the branch under *Git* settings if it is not `main`). Framework preset: **Other**. Build/output settings come from `vercel.json`.
3. Add the variables above, then **Deploy**.
4. Open the site, log in with the admin account, then delete `ADMIN_PASSWORD` in Vercel and redeploy.

Health check: `/api/health`.

### Running against Neon from your PC

Put the same `DATABASE_URL` and **the same `APP_SECRET`** in your local `.env` and run `npm start`. Your PC and the live site then share one database. Leave `DATABASE_URL` empty to use a private local database instead.

### Other hosts

Anything that runs `npm start` works too (Render, a VPS, Docker via the included `Dockerfile`): set `DATABASE_URL`, `APP_SECRET`, `NODE_ENV=production` and `TRUST_PROXY=1`.

### Notes

- Sessions are stored in the database, encrypted with a key that only exists in the user's cookie, so a stolen database still can't be decrypted and deploys don't log anyone out.
- Back up the database from Neon's dashboard now and then, and keep `APP_SECRET` stored separately from those backups.

## Going to production

- Run behind HTTPS (Caddy, nginx, or a host such as Render or Railway). Set `NODE_ENV=production` and `TRUST_PROXY=1`.
- Set `APP_SECRET` from a secrets manager and back it up separately from the database.
- Back up the `data/` folder regularly.
- Ideas for later: PostgreSQL, budgets and alerts, CSV export, offline support (service worker), email for admin warnings.
