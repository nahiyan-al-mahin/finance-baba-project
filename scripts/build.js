'use strict';
// Copies browser files that live outside public/ into it, so static hosts (Vercel's CDN) can serve them.
// Locally the Express server serves the same paths directly, so this step is only needed for deploys.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const copies = [
  ['node_modules/chart.js/dist/chart.umd.min.js', 'public/vendor/chart.js/chart.umd.min.js'],
  ['shared/categories.js', 'public/shared/categories.js'],
];

for (const [from, to] of copies) {
  fs.mkdirSync(path.dirname(path.join(ROOT, to)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, from), path.join(ROOT, to));
  console.log(`copied ${from} -> ${to}`);
}
