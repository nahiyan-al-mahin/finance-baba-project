'use strict';
// Local / VPS entry point: `npm start`. On Vercel, api/index.js is used instead.
const app = require('./app');
const db = require('./db');
const { PORT, DATABASE_URL } = require('./config');
const { runMonthlyReports } = require('./monthlyReports');

db.ready
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Finance Baba running at http://localhost:${PORT}`);
      console.log(DATABASE_URL ? 'Database: Postgres (DATABASE_URL)' : 'Database: local PGlite in data/pgdata (set DATABASE_URL to use Neon)');
    });
    // On your own server there is no Vercel Cron: check for due monthly reports every hour.
    const tick = () => runMonthlyReports().then((r) => r.sent && console.log('[finance-baba] Monthly reports:', r)).catch((e) => console.error(e));
    setTimeout(tick, 10 * 1000).unref();
    setInterval(tick, 60 * 60 * 1000).unref();
  })
  .catch((err) => {
    console.error('Could not open the database:', err.message);
    process.exit(1);
  });
