'use strict';

// The web portal was replaced once by an older upload that brought back sample data,
// browser-only reviews and user changes, and public sign-up. These checks read the
// portal's source so that kind of revert fails the test run instead of going unnoticed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

// ---- No sample data, and load errors are shown ----

test('shared.js seeds no sample data and has no upgradeOldData wipe', () => {
  const shared = read('frontend/js/shared.js');
  assert.doesNotMatch(shared, /makeStarting(Species|Observations|Users)/);
  assert.doesNotMatch(shared, /upgradeOldData/);
  assert.doesNotMatch(shared, /REMOVED_SAMPLE_EMAILS|OLD_DEMO_HASHES/);
});

test('shared.js shows the database error banner on every page with a menu', () => {
  const shared = read('frontend/js/shared.js');
  assert.match(shared, /function showDatabaseProblem\(\)/);
  const drawMenu = shared.slice(shared.indexOf('function drawMenu('));
  assert.match(drawMenu.slice(0, drawMenu.indexOf('\n}')), /showDatabaseProblem\(\);/);
});

// ---- Reviews use the real officer API ----

test('the approval queue loads, shows photos for and decides on real reviews', () => {
  const queue = read('frontend/js/queue.js');
  assert.match(queue, /api\('\/officer\/reviews\/pending'\)/);
  assert.match(queue, /'\/officer\/reviews\/' \+ id \+ '\/photos'/);
  assert.match(queue, /'\/officer\/reviews\/' \+ id \+ '\/decision'/);
  assert.doesNotMatch(queue, /getObservations\(|writeStorage\(OBSERVATIONS_KEY/);
});

test('the rejected list reads real rejected reviews', () => {
  const rejected = read('frontend/js/rejected.js');
  assert.match(rejected, /api\('\/officer\/reviews\/rejected'\)/);
  assert.doesNotMatch(rejected, /getObservations\(|writeStorage\(OBSERVATIONS_KEY/);
});

// ---- User admin changes real permissions ----

test('user changes are saved to website_users, which the database copies to profiles', () => {
  const shared = read('frontend/js/shared.js');
  const users = read('frontend/js/users.js');
  // USERS_KEY is saved through /api/web-data/users (website_users), not only in the browser.
  assert.match(shared, /key: USERS_KEY, path: '\/users'/);
  assert.match(read('backend/src/routes/webData.js'), /website_users/);
  // The page shows the real account status and can activate pending accounts.
  assert.match(users, /from\('profiles'\)\.select\('id, account_status'\)/);
  assert.match(users, /Pending approval/);
  assert.match(users, /if \(writeStorage\(USERS_KEY, list\)\)/);
  // The trigger that copies website_users changes to profiles (role, account_status).
  const migrations = fs.readdirSync(path.join(repoRoot, 'supabase/migrations'))
    .map(file => read(path.join('supabase/migrations', file)))
    .join('\n');
  assert.match(migrations, /FUNCTION public\.sync_website_user_to_profile\(\)/);
});

test('only the officer can change website data on the server', () => {
  const webData = read('backend/src/routes/webData.js');
  assert.match(webData, /function isOfficer\(req\)/);
  assert.match(webData, /router\.put\("\/:key", async \(req, res\) => \{\s*if \(!isOfficer\(req\)\)/);
});

// ---- No public sign-up, staff-only portal ----

test('the login page does not offer sign-up and keeps non-staff accounts out', () => {
  const login = read('frontend/js/login.js');
  assert.match(login, /\['botanist', 'officer', 'researcher', 'admin'\]\.indexOf\(me\.role\) === -1/);
  assert.doesNotMatch(login, /Create an account/i);
  assert.doesNotMatch(read('frontend/users.html'), /sign-up page/i);
});

// ---- Expired logins are renewed, or the officer is sent to log in again ----

test('api() renews an expiring login and sends the officer to log in when it cannot', () => {
  const shared = read('frontend/js/shared.js');
  assert.match(shared, /const SESSION_EXPIRED_MESSAGE = 'Your session expired, please log in again\.';/);
  const getToken = shared.slice(shared.indexOf('window.getOfficerAccessToken'), shared.indexOf('async function sendToLoginExpired'));
  assert.match(getToken, /sb\.auth\.refreshSession\(\)/);
  const api = shared.slice(shared.indexOf('async function api('));
  const apiBody = api.slice(0, api.indexOf('\n}\n'));
  assert.match(apiBody, /response\.status === 401/);
  assert.match(apiBody, /sendToLoginExpired\(\)/);
  assert.match(shared, /location\.replace\('login\.html'\)/);
});
