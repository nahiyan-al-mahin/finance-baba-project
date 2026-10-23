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
| **SQLite** (`better-sqlite3`) | A single-file database with no separate server to install. You can move to PostgreSQL later when traffic grows. |
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
6. The unwrapped data key lives **only in server memory** while the user is logged in. Sessions end after 30 minutes idle or 12 hours. Restarting the server logs everyone out.
7. Cookies are `HttpOnly` and `SameSite=Strict`, with a CSRF header check, a strict Content-Security-Policy and account lockout after 5 wrong passwords.

> ⚠️ **Back up `data/secret.key`** (or set `APP_SECRET`). Without it, nothing in the database can be decrypted. Users who lose both their password and their recovery code cannot get their data back. That is by design.

## Getting started

```bash
npm install
cp .env.example .env          # optional; a secret is auto-generated if APP_SECRET is empty
npm start                     # http://localhost:3000
npm run dev                   # same, but restarts on file changes
```

Create an admin account (the password is asked for interactively):

```bash
npm run create-admin -- admin "Site Admin"
```

Admins log in on the normal login page and are sent to `/admin`.

### Enabling "Continue with Google"

1. Open the [Google Cloud Console](https://console.cloud.google.com/apis/credentials) and go to **Create credentials → OAuth client ID → Web application**.
2. Under **Authorized JavaScript origins**, add your site, e.g. `http://localhost:3000` and `https://your-domain.com`.
3. Put the client ID in `.env` as `GOOGLE_CLIENT_ID=...apps.googleusercontent.com` and restart.

The Google button appears only when `GOOGLE_CLIENT_ID` is set. First-time Google users still choose a username and password: the password protects past days and works as a fallback login. Existing users can connect or disconnect Google under **Settings**.

Run the tests:

```bash
npm test
```

To test on your phone, run the server and open `http://<your-computer-ip>:3000` on the same Wi-Fi.

## Project structure

```
server/
  index.js            Express app: security headers, routes, static files
  config.js           Settings and server secret
  crypto.js           Key derivation, AES-GCM, recovery codes
  db.js               SQLite schema
  users.js            Sign-up, login, lockout, password change, recovery, Google linking
  google.js           Google ID-token verification
  sessions.js         In-memory sessions (holds the decrypted data key)
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

## Deploying

The app is **one Node.js process plus one SQLite file**, so it needs a host that:

1. runs a long-lived Node 22+ server (not "serverless" functions), and
2. gives you a **persistent disk/volume** for the `data/` folder (otherwise every redeploy wipes all accounts).

Good fits: **Railway** (easiest), **Render** (paid plan with a disk), **Fly.io**, or any small VPS.

### Environment variables (all hosts)

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` (secure cookies, HTTPS-only headers) |
| `TRUST_PROXY` | `1` (the host puts a proxy in front of the app) |
| `APP_SECRET` | 64 hex chars: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Save a copy somewhere safe** — without it the data can never be decrypted. |
| `DATA_DIR` | the mount path of your persistent volume, e.g. `/data` |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | optional: creates the first admin at start-up. Remove `ADMIN_PASSWORD` once the log says the admin was created. |
| `GOOGLE_CLIENT_ID` | optional, only when you enable Google sign-in |

Health check path: `/api/health`.

### Railway (recommended)

1. Merge the work into your `main` branch (or pick the branch in step 3).
2. On [railway.com](https://railway.com) → **New Project → Deploy from GitHub repo** → choose `finance-baba-project`.
3. In the service → **Settings**: Source branch = the branch you want; Start command = `npm start` (detected automatically). Railway also understands the included `Dockerfile`.
4. **Add a Volume** (right-click the service → *Attach volume*) with mount path `/data`.
5. **Variables**: add the table above (`DATA_DIR=/data`).
6. **Settings → Networking → Generate Domain**. Open the URL — you get HTTPS automatically.

### Render

New **Web Service** from the repo → Runtime *Node*, Build `npm ci`, Start `npm start` → add a **Disk** mounted at `/data` (needs a paid instance; the free tier has no disk and would lose data) → add the variables above.

### Your own server (VPS)

```bash
git clone https://github.com/nahiyan-al-mahin/finance-baba-project.git && cd finance-baba-project
npm ci --omit=dev
cp .env.example .env   # fill in NODE_ENV=production, TRUST_PROXY=1, APP_SECRET, DATA_DIR
npx pm2 start server/index.js --name finance-baba && npx pm2 save
```

Put [Caddy](https://caddyserver.com) in front for automatic HTTPS (`your-domain.com { reverse_proxy localhost:3000 }`).

### After deploying

- Back up the volume (`finance-baba.db`) regularly, and keep `APP_SECRET` stored separately from those backups.
- Run one instance only: sessions live in memory, and a restart logs everyone out (by design).
- Adding Google later: add your live URL (e.g. `https://your-app.up.railway.app`) to *Authorized JavaScript origins* in Google Cloud, then set `GOOGLE_CLIENT_ID` and redeploy.

## Going to production

- Run behind HTTPS (Caddy, nginx, or a host such as Render or Railway). Set `NODE_ENV=production` and `TRUST_PROXY=1`.
- Set `APP_SECRET` from a secrets manager and back it up separately from the database.
- Back up the `data/` folder regularly.
- Ideas for later: PostgreSQL, budgets and alerts, CSV export, offline support (service worker), email for admin warnings.
