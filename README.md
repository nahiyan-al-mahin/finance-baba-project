# Finance Baba (ফাইন্যান্স বাবা)

A mobile-friendly personal finance diary. Users log what they spend and what they earn each day. The app shows the daily total, analyses each week, month and year, and exports full PDF statements. It works in **English and বাংলা**, with **light (default) and dark** themes.

## Features

| Area | What it does |
| --- | --- |
| Accounts | Sign up / log in with a username and password. A one-time **recovery code** resets a forgotten password without losing data. |
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
| **PDFKit** | Generates PDFs on the server. The bundled Noto Sans Bengali font renders Bangla correctly. |
| **helmet** and **express-rate-limit** | Security headers (a strict CSP) and brute-force protection. |

No frontend framework or build step is involved: edit a file and refresh the page.

## How the encryption works

Even a full copy of the database is useless to an attacker:

1. Each user has a random 256-bit **data key**. Every amount, category, note and name is encrypted with it using **AES-256-GCM**. Only entry dates are stored in plain text, because date-range queries need them.
2. The data key is stored only in **wrapped** (encrypted) form. The wrapping key comes from the user's password: **scrypt**, then **HKDF** mixed with a server secret. A second wrapped copy uses the recovery code.
3. Passwords are never stored. Only a derived verifier is kept.
4. Usernames are stored as a keyed hash (HMAC), so they cannot be read either.
5. The unwrapped data key lives **only in server memory** while the user is logged in. Sessions end after 30 minutes idle or 12 hours. Restarting the server logs everyone out.
6. Cookies are `HttpOnly` and `SameSite=Strict`, with a CSRF header check, a strict Content-Security-Policy and account lockout after 5 wrong passwords.

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
  users.js            Sign-up, login, lockout, password change and recovery
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

## Going to production

- Run behind HTTPS (Caddy, nginx, or a host such as Render or Railway). Set `NODE_ENV=production` and `TRUST_PROXY=1`.
- Set `APP_SECRET` from a secrets manager and back it up separately from the database.
- Back up the `data/` folder regularly.
- Ideas for later: PostgreSQL, budgets and alerts, CSV export, offline support (service worker), email for admin warnings.
