'use strict';
// Local / VPS entry point: `npm start`. On Vercel, api/index.js is used instead.
const app = require('./app');
const db = require('./db');
const { PORT, DATABASE_URL } = require('./config');

db.ready
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Finance Baba running at http://localhost:${PORT}`);
      console.log(DATABASE_URL ? 'Database: Postgres (DATABASE_URL)' : 'Database: local PGlite in data/pgdata (set DATABASE_URL to use Neon)');
    });
  })
  .catch((err) => {
    console.error('Could not open the database:', err.message);
    process.exit(1);
  });
