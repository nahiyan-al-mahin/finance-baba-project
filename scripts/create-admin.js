'use strict';
// Usage: npm run create-admin -- <username> <display name>
// The password is asked interactively so it never lands in shell history.
const readline = require('readline');
const users = require('../server/users');
const { DEFAULT_TZ } = require('../server/config');

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => rl.output.write(s.includes(question) ? s : '');
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

(async () => {
  const [username, ...nameParts] = process.argv.slice(2);
  if (!username) {
    console.error('Usage: npm run create-admin -- <username> [display name]');
    process.exit(1);
  }
  const password = process.env.ADMIN_PASSWORD || (await askHidden('Admin password: '));
  try {
    const { user } = await users.createUser({
      username,
      displayName: nameParts.join(' ') || 'Admin',
      password,
      timezone: DEFAULT_TZ,
      role: 'admin',
    });
    console.log(`Admin "${users.normalizeUsername(username)}" created (${user.public_id}).`);
  } catch (err) {
    console.error(`Could not create admin: ${err.code || err.message}`);
    process.exit(1);
  }
})();
