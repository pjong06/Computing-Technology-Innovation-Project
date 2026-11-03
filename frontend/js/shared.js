// shared.js - the saved data, the left menu and small helpers used by every page.


// Connection to Supabase and the backend
// The publishable key is meant to be public. NEVER put a service_role key here.
const SUPABASE_URL = 'https://yzhxjzbzslnveskkwvfy.supabase.co';
const SUPABASE_KEY = 'sb_publishable_4L1RojeFv6wLAsFNX2q3KQ_hjanSuTo';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { storageKey: 'niah_supabase_auth' } });
window.sb = sb;

// Gives back the login token, or null if nobody is logged in.
window.getOfficerAccessToken = async function () {
  const result = await sb.auth.getSession();
  return result.data.session ? result.data.session.access_token : null;
};

// Calls the backend
async function api(path, options) {
  options = options || {};
  const token = await window.getOfficerAccessToken();
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers);
  if (token) {
    headers.Authorization = 'Bearer ' + token;
  }
  const response = await fetch('/api' + path, Object.assign({}, options, { headers: headers }));
  const body = await response.json().catch(function () { return {}; });
  if (response.ok === false) {
    throw new Error(body.message || ('Request failed (' + response.status + ')'));
  }
  return body;
}


const SPECIES_KEY = 'niah_species';
const OBSERVATIONS_KEY = 'niah_observations';
const USERS_KEY = 'niah_users';
const EDIT_KEY = 'niah_editing';
const TOAST_KEY = 'niah_toast';
const VERSION_KEY = 'niah_data_version';
const SESSION_KEY = 'niah_session';
// Suspended botanists are told to contact the officer at this email.
const OFFICER_CONTACT_EMAIL = 'georgetanyonghan@gmail.com';
// Sample users that were deleted on purpose. They are removed from saved data and not added again.
const REMOVED_SAMPLE_EMAILS = ['mei@gmail.com'];
const DATA_VERSION = 4;

// Turns the text of an SVG drawing into an image address that an <img> tag can show.
function svgPicture(svg) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

const PICTURE_RAFFLESIA = svgPicture('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><rect width="56" height="56" fill="#3b4a2a"/><circle cx="28" cy="13" r="10" fill="#e0623a"/><circle cx="28" cy="13" r="10" fill="#e0623a" transform="rotate(72 28 28)"/><circle cx="28" cy="13" r="10" fill="#e0623a" transform="rotate(144 28 28)"/><circle cx="28" cy="13" r="10" fill="#e0623a" transform="rotate(216 28 28)"/><circle cx="28" cy="13" r="10" fill="#e0623a" transform="rotate(288 28 28)"/><circle cx="28" cy="28" r="11" fill="#f0a070"/><circle cx="28" cy="28" r="6" fill="#7a2410"/></svg>');
const PICTURE_SHOREA = svgPicture('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><rect width="56" height="56" fill="#cfe3c4"/><rect x="25" y="26" width="6" height="28" fill="#6b4a2f"/><circle cx="28" cy="20" r="14" fill="#4f8a4f"/><circle cx="18" cy="26" r="9" fill="#5b9a58"/><circle cx="38" cy="26" r="9" fill="#5b9a58"/></svg>');
const PICTURE_NEPENTHES = svgPicture('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><rect width="56" height="56" fill="#1f3a2a"/><path d="M28 6c-9 0-12 10-12 20 0 9 5 16 12 16s12-7 12-16C40 16 37 6 28 6z" fill="#e8962e"/><ellipse cx="28" cy="8" rx="9" ry="3.5" fill="#a85d12"/><path d="M28 42v10" stroke="#7fae8f" stroke-width="3"/></svg>');
const PICTURE_DIPTEROCARPUS = svgPicture('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><rect width="56" height="56" fill="#6aa05a"/><path d="M10 46C10 22 26 8 46 10 46 32 34 46 10 46z" fill="#2f6b3a"/><path d="M12 44L38 18" stroke="#a9d49a" stroke-width="2"/></svg>');
const PICTURE_BLANK = svgPicture('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><rect width="56" height="56" fill="#6aa05a"/><path d="M10 46C10 22 26 8 46 10 46 32 34 46 10 46z" fill="#2f6b3a"/><path d="M12 44L38 18" stroke="#a9d49a" stroke-width="2"/></svg>');

// ---------- Saved data lives in the database ----------
// Each page has its own table with one column for each detail:
//   Species catalogue and editor -> website_species
//   Observation queue and rejected -> website_observations
//   User & role admin -> website_users (one row for each real login account)
// Only the data version is kept in the table web_data.
// Everything else (the login copy, the editor shortcut, the pop-up message) stays in this browser.
const DATABASE_KEYS = [SPECIES_KEY, OBSERVATIONS_KEY, USERS_KEY, VERSION_KEY];
const AUTH_STORAGE_KEY = 'niah_supabase_auth';
const NOT_LOGGED_IN = 'You are not logged in.';
let databaseCache = {};     // the saved values, as text, loaded when the page opens
let databaseReady = false;  // true when the values were loaded from the database
let databaseProblem = '';   // the reason the database could not be used, if any
let databaseSaved = {};     // what each list looked like when it was last loaded or saved
let databaseIds = {};       // the ids each list had when it was last loaded or saved
let databasePrints = {};    // a fingerprint of each record (by id) when its list was last loaded or saved

// Turns text like "14 Sep 2026, 3:42 PM" into a date and time the database understands.
// Returns null when the text is empty or not in that form.
function whenTextToIso(text) {
  const match = /^(\d{1,2}) (\w{3}) (\d{4}), (\d{1,2}):(\d{2}) (AM|PM)$/.exec(text || '');
  if (match === null) {
    return null;
  }
  const month = MONTHS.indexOf(match[2]);
  if (month === -1) {
    return null;
  }
  let hour = parseInt(match[4], 10) % 12;
  if (match[6] === 'PM') {
    hour = hour + 12;
  }
  const date = new Date(parseInt(match[3], 10), month, parseInt(match[1], 10), hour, parseInt(match[5], 10));
  return date.toISOString();
}

// Works out the saved date and time of a species: from the "when" text, or else from the plain date.
function savedTime(whenText, dateText) {
  const fromText = whenTextToIso(whenText);
  if (fromText !== null) {
    return fromText;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateText || '')) {
    return new Date(dateText + 'T00:00:00').toISOString();
  }
  return null;
}

// The lists that have their own table in the database.
// text = [name used by the pages, column in the table]
// times = [column, text like "14 Sep 2026, 3:42 PM", plain date like "2026-09-14"]
// flags = [name used by the pages, column] for yes/no values
// picture = true when the pages show a picture for each record. A record without a saved photo
// shows the default picture of its plant type.
const LIST_TABLES = [
  {
    key: SPECIES_KEY, path: '/species', picture: true,
    text: [['sci', 'scientific_name'], ['com', 'common_name'], ['fam', 'family'], ['status', 'conservation_status'],
      ['loc', 'location_name'], ['gps', 'gps'], ['desc', 'description'], ['obsId', 'observation_id'], ['photo', 'photo']],
    times: [['first_recorded', 'firstWhen', 'firstDate'], ['last_updated', 'when', 'date']],
    flags: []
  },
  {
    key: OBSERVATIONS_KEY, path: '/observations', picture: true,
    text: [['sci', 'scientific_name'], ['com', 'common_name'], ['fam', 'family'], ['by', 'observed_by'],
      ['loc', 'location_name'], ['gps', 'gps'], ['notes', 'notes'], ['photo', 'photo'],
      ['state', 'state'], ['reason', 'reject_reason']],
    times: [['observed_at', 'when', 'date']],
    flags: []
  },
  {
    key: USERS_KEY, path: '/users',
    text: [['name', 'name'], ['username', 'username'], ['email', 'email'], ['role', 'role']],
    times: [],
    flags: [['active', 'active']]
  }
];

// Returns the table setup for a saved key, or null when the key has no table of its own.
function findListTable(key) {
  for (let i = 0; i < LIST_TABLES.length; i++) {
    if (LIST_TABLES[i].key === key) {
      return LIST_TABLES[i];
    }
  }
  return null;
}

// Returns the default picture of a species or observation, chosen by the first word of its
// scientific name (the genus). Rafflesia gets the flower, Shorea the tree, Nepenthes the pitcher
// plant and Dipterocarpus the leaf. Any other plant gets the blank leaf.
function fallbackPicture(scientificName) {
  const genus = String(scientificName || '').trim().toLowerCase().split(' ')[0];
  const samples = makeStartingSpecies();
  for (let i = 0; i < samples.length; i++) {
    if (genus !== '' && samples[i].sci.toLowerCase().split(' ')[0] === genus) {
      return samples[i].photo;
    }
  }
  return PICTURE_BLANK;
}

// Turns an item used by the pages (a species, an observation or a user) into one row of its table.
// Anything the table has no column for goes into "extra", so nothing is lost.
function itemToRow(item, table) {
  const row = { id: item.id };
  const used = { id: true, passwordHash: true };

  for (let i = 0; i < table.text.length; i++) {
    const value = item[table.text[i][0]];
    row[table.text[i][1]] = (value === undefined || value === null) ? '' : String(value);
    used[table.text[i][0]] = true;
  }
  // The default pictures are not saved. Only photos uploaded by users are.
  if (row.photo !== undefined && row.photo.indexOf('data:image/svg+xml') === 0) {
    row.photo = '';
  }
  for (let i = 0; i < table.times.length; i++) {
    row[table.times[i][0]] = savedTime(item[table.times[i][1]], item[table.times[i][2]]);
    used[table.times[i][1]] = true;
    used[table.times[i][2]] = true;
  }
  for (let i = 0; i < table.flags.length; i++) {
    row[table.flags[i][1]] = item[table.flags[i][0]] !== false;
    used[table.flags[i][0]] = true;
  }

  const extra = {};
  const names = Object.keys(item);
  for (let i = 0; i < names.length; i++) {
    if (used[names[i]] !== true) {
      extra[names[i]] = item[names[i]];
    }
  }
  row.extra = extra;
  return row;
}

// Turns one row of a table back into an item used by the pages.
function rowToItem(row, table) {
  const item = Object.assign({}, row.extra || {});
  item.id = row.id;

  for (let i = 0; i < table.text.length; i++) {
    const value = row[table.text[i][1]];
    item[table.text[i][0]] = (value === undefined || value === null) ? '' : value;
  }
  for (let i = 0; i < table.times.length; i++) {
    const saved = row[table.times[i][0]] ? new Date(row[table.times[i][0]]) : null;
    item[table.times[i][2]] = saved ? isoDate(saved) : '';
    item[table.times[i][1]] = saved ? whenText(saved) : '';
  }
  for (let i = 0; i < table.flags.length; i++) {
    item[table.flags[i][0]] = row[table.flags[i][1]] !== false;
  }
  if (table.picture === true && !item.photo) {
    item.photo = fallbackPicture(item.sci);
  }
  return item;
}

// Returns the ids of the items that have one.
function idsOf(items) {
  const ids = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].id) {
      ids.push(items[i].id);
    }
  }
  return ids;
}

// Makes a fingerprint of each record that has an id, so a save can send only the records that changed.
// Sending every record would also try to rewrite the records that belong to other people,
// and the database refuses that for a botanist.
function rowPrints(items, table) {
  const prints = {};
  for (let i = 0; i < items.length; i++) {
    if (items[i].id) {
      prints[items[i].id] = JSON.stringify(itemToRow(items[i], table));
    }
  }
  return prints;
}

// Makes a short fingerprint of a list, to tell whether it changed since it was loaded or saved.
function listFingerprint(items, table) {
  return JSON.stringify(items.map(function (item) {
    return itemToRow(item, table);
  }));
}

// Creates a real login account. The database then adds the profile and the row in website_users by itself.
// client is the Supabase connection to use. Returns what Supabase returns: { data, error }.
async function createAccount(client, username, email, password) {
  return client.auth.signUp({
    email: email,
    password: password,
    options: { data: { source: 'website', username: username, name: username } }
  });
}

// Returns the login token without waiting. If it has run out, asks Supabase for a new one.
// Returns null when there is no login.
function getTokenNow() {
  const text = localStorage.getItem(AUTH_STORAGE_KEY);
  if (text === null) {
    return null;
  }
  let session = null;
  try {
    session = JSON.parse(text);
  } catch (error) {
    return null;
  }
  if (session === null || !session.access_token) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at && session.expires_at - 30 > now) {
    return session.access_token;
  }

  // The token has run out. Ask Supabase for a new one.
  if (!session.refresh_token) {
    return null;
  }
  const request = new XMLHttpRequest();
  request.open('POST', SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', false);
  request.setRequestHeader('apikey', SUPABASE_KEY);
  request.setRequestHeader('Content-Type', 'application/json');
  try {
    request.send(JSON.stringify({ refresh_token: session.refresh_token }));
  } catch (error) {
    return null;
  }
  if (request.status !== 200) {
    return null;
  }
  const fresh = JSON.parse(request.responseText);
  fresh.expires_at = now + fresh.expires_in;
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(fresh));
  return fresh.access_token;
}

// Talks to the backend and waits for the answer, so the pages can stay as they are.
// Returns { ok: true, data: ... } or { ok: false, message: '...' }.
function databaseRequest(method, path, body) {
  const token = getTokenNow();
  if (token === null) {
    return { ok: false, message: NOT_LOGGED_IN };
  }
  const request = new XMLHttpRequest();
  request.open(method, '/api/web-data' + path, false);
  request.setRequestHeader('Content-Type', 'application/json');
  request.setRequestHeader('Authorization', 'Bearer ' + token);
  try {
    if (body === undefined) {
      request.send(null);
    } else {
      request.send(JSON.stringify(body));
    }
  } catch (error) {
    return { ok: false, message: 'Could not reach the backend. Is it running?' };
  }

  let reply = {};
  try {
    reply = JSON.parse(request.responseText);
  } catch (error) {
    reply = {};
  }
  if (request.status < 200 || request.status >= 300) {
    return { ok: false, message: reply.message || ('Database error ' + request.status) };
  }
  return { ok: true, data: reply.data };
}

// Loads the saved values from the database when a page opens.
function loadFromDatabase() {
  if (OPEN_PAGES.indexOf(thisPageName()) !== -1) {
    return;
  }
  const result = databaseRequest('GET', '', undefined);
  if (result.ok === false) {
    databaseProblem = result.message;
    if (result.message === NOT_LOGGED_IN) {
      // The login has run out, so forget the saved copy and the page sends the person to the login page.
      localStorage.removeItem(SESSION_KEY);
    }
    return;
  }
  const version = result.data[VERSION_KEY];
  if (version !== undefined) {
    databaseCache[VERSION_KEY] = JSON.stringify(version);
  }

  // The species, observations and users come from their own tables.
  for (let i = 0; i < LIST_TABLES.length; i++) {
    const table = LIST_TABLES[i];
    const listResult = databaseRequest('GET', table.path, undefined);
    if (listResult.ok === false) {
      databaseProblem = listResult.message;
      return;
    }
    const items = listResult.data.map(function (row) {
      return rowToItem(row, table);
    });
    // An empty table means "nothing yet" only after the website was set up once.
    // Before that, the page adds the sample records by itself.
    if (items.length > 0 || databaseCache[VERSION_KEY] !== undefined) {
      databaseCache[table.key] = JSON.stringify(items);
      databaseSaved[table.key] = listFingerprint(items, table);
      databaseIds[table.key] = idsOf(items);
      databasePrints[table.key] = rowPrints(items, table);
    }
  }
  databaseReady = true;
}

// Loads one list from the database again, for example after a new account was created.
// Returns true if it worked.
function reloadFromDatabase(key) {
  const table = findListTable(key);
  if (table === null) {
    return false;
  }
  const listResult = databaseRequest('GET', table.path, undefined);
  if (listResult.ok === false) {
    return false;
  }
  const items = listResult.data.map(function (row) {
    return rowToItem(row, table);
  });
  databaseCache[key] = JSON.stringify(items);
  databaseSaved[key] = listFingerprint(items, table);
  databaseIds[key] = idsOf(items);
  databasePrints[key] = rowPrints(items, table);
  return true;
}

// Reads a saved value. Returns null if nothing is saved.
function readStorage(key) {
  let text = null;
  if (DATABASE_KEYS.indexOf(key) !== -1) {
    if (databaseCache[key] !== undefined) {
      text = databaseCache[key];
    }
  } else {
    text = localStorage.getItem(key);
  }
  if (text === null) {
    return null;
  }
  return JSON.parse(text);
}

// Saves a value. Returns true if it worked, false if it could not be saved.
function writeStorage(key, value) {
  if (DATABASE_KEYS.indexOf(key) === -1) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  databaseCache[key] = JSON.stringify(value);
  if (databaseReady === false) {
    // The login and password pages have no database data. Anywhere else this is a problem.
    return OPEN_PAGES.indexOf(thisPageName()) !== -1;
  }

  const table = findListTable(key);
  if (table !== null) {
    // Nothing changed since the list was loaded, so there is nothing to save.
    if (listFingerprint(value, table) === databaseSaved[key]) {
      return true;
    }
    // Send only the records that are new or changed since the list was loaded or saved.
    // position keeps the order of the full list.
    const known = databasePrints[key] || {};
    const rows = [];
    const sentAt = [];
    for (let i = 0; i < value.length; i++) {
      const row = itemToRow(value[i], table);
      if (value[i].id && known[value[i].id] === JSON.stringify(row)) {
        continue;
      }
      row.position = i;
      rows.push(row);
      sentAt.push(i);
    }
    // Only the records this page really deleted are removed from the database.
    const nowIds = idsOf(value);
    const removed = (databaseIds[key] || []).filter(function (id) {
      return nowIds.indexOf(id) === -1;
    });
    const saved = databaseRequest('PUT', table.path, { rows: rows, removed: removed });
    if (saved.ok === false) {
      showToast('Could not save to the database: ' + saved.message);
      return false;
    }
    // The database gives every new species and user its id. Put the saved records back in the list.
    const savedItems = value.slice();
    for (let k = 0; k < sentAt.length; k++) {
      savedItems[sentAt[k]] = rowToItem(saved.data[k], table);
    }
    databaseCache[key] = JSON.stringify(savedItems);
    databaseSaved[key] = listFingerprint(savedItems, table);
    databaseIds[key] = idsOf(savedItems);
    databasePrints[key] = rowPrints(savedItems, table);
    return true;
  }

  const toSend = value;
  const result = databaseRequest('PUT', '/' + key, { value: toSend });
  if (result.ok === false) {
    showToast('Could not save to the database: ' + result.message);
    return false;
  }
  return true;
}


const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Adds a zero in front of a single digit, so 5 becomes "05".
function twoDigits(number) {
  return ('0' + number).slice(-2);
}

// Turns a Date into text like "2026-09-14". Used for sorting and for the date range.
function isoDate(d) {
  return d.getFullYear() + '-' + twoDigits(d.getMonth() + 1) + '-' + twoDigits(d.getDate());
}

// Turns a Date into text with the date and the time, like "14 Sep 2026, 3:42 PM".
function whenText(d) {
  let hour = d.getHours();
  let ampm = 'AM';
  if (hour >= 12) {
    ampm = 'PM';
  }
  hour = hour % 12;
  if (hour === 0) {
    hour = 12;
  }
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ', ' +
    hour + ':' + twoDigits(d.getMinutes()) + ' ' + ampm;
}

// Returns the sample species used the first time a page opens.
// date and when = last updated. firstDate and firstWhen = first recorded.
// obsId = the id of the observation that created the record (empty for the samples).
function makeStartingSpecies() {
  return [
    {
      sci: 'Rafflesia tuan-mudae', com: 'Corpse flower', fam: 'Rafflesiaceae',
      status: 'Endangered', loc: 'West trail junction', gps: '3.2247, 113.7631',
      desc: 'A parasitic flowering plant that produces the largest individual flower in the world. It has no visible leaves, stems or roots.',
      photo: PICTURE_RAFFLESIA,
      date: '2026-09-14', when: '14 Sep 2026, 3:42 PM',
      firstDate: '2026-09-14', firstWhen: '14 Sep 2026, 3:42 PM'
    },
    {
      sci: 'Shorea platyclados', com: 'Meranti bukit', fam: 'Dipterocarpaceae',
      status: 'Vulnerable', loc: '2.3km trail, Niah', gps: '3.2201, 113.7702',
      desc: 'A large lowland dipterocarp tree found along the Niah trail.',
      photo: PICTURE_SHOREA,
      date: '2026-09-10', when: '10 Sep 2026, 10:20 AM',
      firstDate: '2026-09-10', firstWhen: '10 Sep 2026, 10:20 AM'
    },
    {
      sci: 'Nepenthes ampullaria', com: 'Pitcher plant', fam: 'Nepenthaceae',
      status: 'Least Concern', loc: 'Cave entrance area', gps: '3.2189, 113.7745',
      desc: 'A carnivorous pitcher plant with rounded, clustered pitchers.',
      photo: PICTURE_NEPENTHES,
      date: '2026-09-14', when: '14 Sep 2026, 11:10 AM',
      firstDate: '2026-09-14', firstWhen: '14 Sep 2026, 11:10 AM'
    },
    {
      sci: 'Dipterocarpus caudatus', com: 'Keruing', fam: 'Dipterocarpaceae',
      status: 'Endangered', loc: 'Keruing', gps: '3.2268, 113.7598',
      desc: 'A tall emergent tree valued for timber, now under pressure.',
      photo: PICTURE_DIPTEROCARPUS,
      date: '2026-09-12', when: '12 Sep 2026, 9:05 AM',
      firstDate: '2026-09-12', firstWhen: '12 Sep 2026, 9:05 AM'
    }
  ];
}

// Returns the three sample observations sent by botanists.
// photo = the picture taken in the field. com and fam = common name and family typed by the botanist.
// state = Pending, Approved or Rejected. reason = why it was rejected.
function makeStartingObservations() {
  return [
    {
      id: 'NP-2026-0417', sci: 'Rafflesia tuan-mudae', com: 'Corpse flower', fam: 'Rafflesiaceae',
      by: 'Brendan Noel', date: '2026-09-14', when: '14 Sep 2026, 3:42 PM',
      loc: 'East ridge trail', gps: '3.2312, 113.7689',
      notes: 'Single bloom, about 60 cm wide. A second site, away from the West trail record.',
      photo: PICTURE_RAFFLESIA,
      state: 'Pending', reason: ''
    },
    {
      id: 'NP-2026-0418', sci: 'Nepenthes rafflesiana', com: 'Raffles pitcher plant', fam: 'Nepenthaceae',
      by: 'Brendan Noel', date: '2026-09-14', when: '14 Sep 2026, 11:10 AM',
      loc: 'Limestone path', gps: '3.2174, 113.7733',
      notes: 'Climbing pitcher plant with large funnel-shaped pitchers. Looks like a new species for the park list.',
      photo: PICTURE_NEPENTHES,
      state: 'Pending', reason: ''
    },
    {
      id: 'NP-2026-0412', sci: 'Dipterocarpus caudatus', com: 'Keruing', fam: 'Dipterocarpaceae',
      by: 'Aina Rahman', date: '2026-09-12', when: '12 Sep 2026, 9:05 AM',
      loc: 'Cave road, km 1', gps: '3.2150, 113.7710',
      notes: 'Height estimated at 38 m. Bark sample not taken.',
      photo: PICTURE_DIPTEROCARPUS,
      state: 'Pending', reason: ''
    }
  ];
}

// Returns the sample users.
// passwordHash = the scrambled password (see hashPassword). Demo passwords:
// George = Officer@123, Brendan and Aina = Botanist@123.
function makeStartingUsers() {
  return [
    { name: 'Brendan Noel', username: 'brendan', email: 'brendan@gmail.com', role: 'Botanist', active: true,
      passwordHash: 'a37702c8480135497221829d63a1d7d0816e5c1b99e4de6479bf53e6a9fb1af2' },
    { name: 'Aina Rahman', username: 'aina', email: 'aina@gmail.com', role: 'Botanist', active: true,
      passwordHash: '4894d1955515afcec2632bbb46e35e8e971439ef8c679e0817f9af32bc4804d9' },
    { name: 'George Tan', username: 'george', email: 'georgetanyonghan@gmail.com', role: 'Conservation Officer', active: true,
      passwordHash: '9b33a0b27ca119cb6e14fee832319e3fc44506bc2aa98cd09389ba8af47d6a4f' }
  ];
}

// Checks if two texts are the same, ignoring capital letters and spaces at the ends.
function sameText(a, b) {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

// Checks if two records are at the same place.
// It compares the GPS numbers, or the location names when a GPS is missing.
function samePlace(a, b) {
  const gpsA = readGps(a.gps);
  const gpsB = readGps(b.gps);
  if (gpsA !== null && gpsB !== null) {
    return gpsA[0] === gpsB[0] && gpsA[1] === gpsB[1];
  }
  return sameText(a.loc, b.loc);
}

// Returns the first record in the list with this scientific name, or null if there is none.
function findByScientificName(list, scientificName) {
  for (let i = 0; i < list.length; i++) {
    if (sameText(list[i].sci, scientificName)) {
      return list[i];
    }
  }
  return null;
}

// Returns the saved list of species records.
// The first time, it saves the sample species. Older records without dates get them filled in.
function getSpecies() {
  let list = readStorage(SPECIES_KEY);
  if (list === null) {
    list = makeStartingSpecies();
    writeStorage(SPECIES_KEY, list);
  }

  let changed = false;
  const starting = makeStartingSpecies();
  for (let i = 0; i < list.length; i++) {
    if (list[i].when === undefined || list[i].firstWhen === undefined) {
      const sample = findByScientificName(starting, list[i].sci);
      if (list[i].when === undefined || list[i].when === '') {
        list[i].date = '';
        list[i].when = '';
        if (sample !== null) {
          list[i].date = sample.date;
          list[i].when = sample.when;
        }
      }
      list[i].firstDate = list[i].date;
      list[i].firstWhen = list[i].when;
      if (sample !== null) {
        list[i].firstDate = sample.firstDate;
        list[i].firstWhen = sample.firstWhen;
      }
      changed = true;
    }
  }
  if (changed) {
    writeStorage(SPECIES_KEY, list);
  }
  return list;
}

// Returns the saved list of observations (the sample ones the first time).
function getObservations() {
  let list = readStorage(OBSERVATIONS_KEY);
  if (list === null) {
    list = makeStartingObservations();
    writeStorage(OBSERVATIONS_KEY, list);
  }
  return list;
}

// Makes a username from the start of an email, like "georgetanyonghan@gmail.com" -> "george".
// A number is added if another user already has it.
function makeUsernameFromEmail(email, list) {
  let base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (base === '') {
    base = 'user';
  }
  let name = base;
  let number = 2;
  while (usernameTaken(list, name)) {
    name = base + number;
    number++;
  }
  return name;
}

// Says if some user in the list already has this username.
function usernameTaken(list, username) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].username !== undefined && sameText(list[i].username, username)) {
      return true;
    }
  }
  return false;
}

// The first sample passwords had no symbol. Accounts still using them get the new sample password.
const OLD_DEMO_HASHES = [
  'ea0d785b0a2382bedd91f03612f1bb0587514ab6c12ea10554ae7c957786a59e',
  '6af89d89092d5a232ea353e5a3a1ae8634f235510e3fc82edd9a9129a1dfd4cb',
  '9ebe6eb9c4e1d636c400413b0d34ed7fa6199f9e29ae39765b78aa3c91bca53b'
];

// Returns the sample password hash for this email, or '' if it is not a sample user.
function findStartingHash(starting, email) {
  for (let i = 0; i < starting.length; i++) {
    if (sameText(starting[i].email, email)) {
      return starting[i].passwordHash;
    }
  }
  return '';
}

// Returns the saved list of users (the sample ones the first time).
// Users saved before logins existed get the sample password if they are a sample user.
function getUsers() {
  let list = readStorage(USERS_KEY);
  if (list === null) {
    list = makeStartingUsers();
    writeStorage(USERS_KEY, list);
  }

  let changed = false;
  const starting = makeStartingUsers();

  // Remove the sample users that were deleted on purpose.
  for (let i = list.length - 1; i >= 0; i--) {
    for (let j = 0; j < REMOVED_SAMPLE_EMAILS.length; j++) {
      if (sameText(list[i].email, REMOVED_SAMPLE_EMAILS[j])) {
        list.splice(i, 1);
        changed = true;
        break;
      }
    }
  }

  for (let i = 0; i < list.length; i++) {
    if (list[i].username === undefined) {
      list[i].username = makeUsernameFromEmail(list[i].email, list);
      changed = true;
    }
    if (list[i].role === 'Administrator') {
      list[i].role = 'Botanist';
      changed = true;
    }
    for (let j = 0; j < OLD_DEMO_HASHES.length; j++) {
      if (list[i].passwordHash === OLD_DEMO_HASHES[j]) {
        list[i].passwordHash = findStartingHash(starting, list[i].email);
        changed = true;
      }
    }
    if (list[i].passwordHash === undefined) {
      list[i].passwordHash = '';
      for (let j = 0; j < starting.length; j++) {
        if (sameText(starting[j].email, list[i].email)) {
          list[i].passwordHash = starting[j].passwordHash;
        }
      }
      changed = true;
    }
  }
  if (changed) {
    writeStorage(USERS_KEY, list);
  }
  return list;
}

// ---------- Login and accounts ----------

// Scrambles a password so the plain password is never saved.
// Returns text (a SHA-256 code). The email is mixed in so two people with the same password get different codes.
// Used with "await", for example: const hash = await hashPassword(email, password);
async function hashPassword(email, password) {
  const text = email.trim().toLowerCase() + ':' + password;
  if (window.crypto && window.crypto.subtle) {
    const bytes = new TextEncoder().encode(text);
    const buffer = await window.crypto.subtle.digest('SHA-256', bytes);
    const parts = new Uint8Array(buffer);
    let hex = '';
    for (let i = 0; i < parts.length; i++) {
      hex += ('0' + parts[i].toString(16)).slice(-2);
    }
    return hex;
  }
  // Very simple backup for browsers without crypto.subtle.
  let number = 5381;
  for (let i = 0; i < text.length; i++) {
    number = ((number * 33) ^ text.charCodeAt(i)) >>> 0;
  }
  return 'x' + number.toString(16);
}

// Checks a new password. Returns a message for the problem, or '' when the password is fine.
// A password needs at least 8 characters, a letter, a number and a symbol (like ! @ # $ %).
function passwordProblem(password) {
  if (password.length < 8) {
    return 'The password must be at least 8 characters.';
  }
  if (/[A-Za-z]/.test(password) === false) {
    return 'The password needs at least one letter.';
  }
  if (/[0-9]/.test(password) === false) {
    return 'The password needs at least one number.';
  }
  if (/[^A-Za-z0-9]/.test(password) === false) {
    return 'The password needs at least one symbol, like ! @ # $ %.';
  }
  return '';
}

// Returns the user whose username or email is this text, or null if there is none.
function findUserByLogin(text) {
  const byUsername = findUserByUsername(text);
  if (byUsername !== null) {
    return byUsername;
  }
  return findUserByEmail(text);
}

// Returns the next free observation id, like "NP-2026-0419".
function nextObservationId(list) {
  let highest = 0;
  for (let i = 0; i < list.length; i++) {
    const number = parseInt(list[i].id.split('-')[2], 10);
    if (number > highest) {
      highest = number;
    }
  }
  return 'NP-2026-' + ('000' + (highest + 1)).slice(-4);
}

// Returns the user with this email, or null if there is none.
function findUserByEmail(email) {
  const list = getUsers();
  for (let i = 0; i < list.length; i++) {
    if (sameText(list[i].email, email)) {
      return list[i];
    }
  }
  return null;
}

// Returns the user with this username, or null if there is none.
function findUserByUsername(username) {
  const list = getUsers();
  for (let i = 0; i < list.length; i++) {
    if (sameText(list[i].username, username)) {
      return list[i];
    }
  }
  return null;
}

// Returns the logged-in user, or null. This is a saved copy; the backend checks the real token.
function getCurrentUser() {
  return readStorage(SESSION_KEY);
}

// Says if this user is a botanist (true) or officer staff (false).
function isBotanist(user) {
  return user.role === 'Botanist';
}

// Saves who is logged in. "me" is what the backend's /api/me sends back.
function startSession(me, username) {
  let role = 'Botanist';
  if (me.role === 'officer') {
    role = 'Conservation Officer';
  }
  const shownName = username || me.email.split('@')[0];
  writeStorage(SESSION_KEY, {
    id: me.id, email: me.email, name: shownName, username: shownName, role: role, active: true
  });
}

// Logs out of Supabase, forgets the saved user and goes back to the login page.
async function logout() {
  await sb.auth.signOut();
  localStorage.removeItem(SESSION_KEY);
  location.href = 'login.html';
}

// Opens the first page after logging in. Botanists and officers both start at the Species catalogue.
function goToHome() {
  location.href = 'species.html';
}

// Pages that need no login
const OPEN_PAGES = [
  'login.html',
  'forgot-password.html',
  'reset-password.html'
];

// Pages a botanist may open. Officers (and administrators) may open every page.
const BOTANIST_PAGES = [
  'species.html', 
  'editor.html', 
  'map.html'
];

// Says if this user may open this page.
function canOpen(user, file) {
  if (isBotanist(user) === false) {
    return true;
  }
  return BOTANIST_PAGES.indexOf(file) !== -1;
}

// Works out the file name of this page, like "queue.html".
function thisPageName() {
  const parts = location.pathname.split('/');
  return parts[parts.length - 1];
}

// If the person was logged in but their account is now suspended, leaves a message for the login page.
function tellIfSuspended() {
  const session = readStorage(SESSION_KEY);
  if (session === null) {
    return;
  }
  const user = findUserByEmail(session.email);
  if (user !== null && user.active === false) {
    rememberToast('Your account is suspended. Contact the officer at ' + OFFICER_CONTACT_EMAIL);
  }
}

// Sends visitors who are not logged in to the login page,
// and sends botanists away from the pages they may not open.
function guardPages() {
  const file = thisPageName();
  if (OPEN_PAGES.indexOf(file) !== -1) {
    return;
  }
  const user = getCurrentUser();
  if (user === null) {
    tellIfSuspended();
    location.replace('login.html');
  } else if (canOpen(user, file) === false) {
    location.replace('species.html');
  }
}

const MENU = [
  { file: 'species.html', label: 'Species catalogue' },
  { file: 'editor.html', label: 'Species record editor' },
  { file: 'queue.html', label: 'Observation approval queue' },
  { file: 'rejected.html', label: 'Rejected observations' },
  { file: 'map.html', label: 'Distribution map' },
  { file: 'reports.html', label: 'Reports & export' },
  { file: 'users.html', label: 'User & role admin' },
  { file: 'alerts.html', label: 'IoT alerts' }
];

// Builds the left menu inside <nav id="menu"> and highlights the page we are on (activeFile).
function drawMenu(activeFile) {
  const nav = document.getElementById('menu');

  const logo = document.createElement('img');
  logo.className = 'logo';
  logo.src = 'images/logo.png';
  logo.alt = 'Niah Biotrack logo';

  const brandName = document.createElement('span');
  brandName.textContent = 'Niah Biotrack';

  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.appendChild(logo);
  brand.appendChild(brandName);
  nav.appendChild(brand);

  const user = getCurrentUser();

  const sub = document.createElement('div');
  sub.className = 'sub';
  if (user !== null) {
    sub.textContent = user.role + ' · Web';
  }
  nav.appendChild(sub);

  for (let i = 0; i < MENU.length; i++) {
    if (user !== null && canOpen(user, MENU[i].file) === false) {
      continue;
    }
    const link = document.createElement('a');
    link.href = MENU[i].file;
    link.textContent = MENU[i].label;
    if (MENU[i].file === activeFile) {
      link.className = 'on';
    }
    nav.appendChild(link);
  }

  const who = document.createElement('div');
  who.className = 'who';
  if (user !== null) {
    const name = document.createElement('div');
    name.textContent = 'Signed in as ' + user.username;
    who.appendChild(name);
  }
  const out = document.createElement('button');
  out.className = 'btn ghost small';
  out.textContent = 'Log out';
  out.onclick = logout;
  who.appendChild(out);
  nav.appendChild(who);
}

// Hides the small pop-up message.
function hideToast() {
  document.getElementById('toast').classList.remove('on');
}

// Shows a small pop-up message for a few seconds.
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('on');
  setTimeout(hideToast, 3500);
}

// Saves a message so the NEXT page shows it. Use it right before jumping to another page.
function rememberToast(message) {
  writeStorage(TOAST_KEY, message);
}

// Shows the message left by the previous page, then forgets it.
function showRememberedToast() {
  const message = readStorage(TOAST_KEY);
  if (message !== null) {
    localStorage.removeItem(TOAST_KEY);
    showToast(message);
  }
}

// Opens the editor page.
// index is the position of the species in the list. Use -1 for a new species.
function openEditorFor(index) {
  writeStorage(EDIT_KEY, index);
  location.href = 'editor.html';
}

// Returns the CSS class of the coloured pill for a conservation status.
function statusClass(status) {
  if (status === 'Endangered') {
    return 'pill e';
  }
  if (status === 'Vulnerable') {
    return 'pill w';
  }
  return 'pill';
}

// Turns the text "3.2247, 113.7631" into the list [3.2247, 113.7631].
// Returns null when the text is not a valid GPS location.
function readGps(text) {
  if (!text) {
    return null;
  }
  const parts = text.split(',');
  if (parts.length !== 2) {
    return null;
  }
  const lat = parseFloat(parts[0]);
  const lng = parseFloat(parts[1]);
  if (isNaN(lat) || isNaN(lng)) {
    return null;
  }
  return [lat, lng];
}

// Turns "3.2247, 113.7631" into "3.2247° N, 113.7631° E". Other text is returned unchanged.
function prettyGps(text) {
  const gps = readGps(text);
  if (gps === null) {
    return text;
  }
  let northSouth = 'N';
  if (gps[0] < 0) {
    northSouth = 'S';
  }
  let eastWest = 'E';
  if (gps[1] < 0) {
    eastWest = 'W';
  }
  return Math.abs(gps[0]).toFixed(4) + '° ' + northSouth + ', ' + Math.abs(gps[1]).toFixed(4) + '° ' + eastWest;
}

// Returns the review status of an observation: Pending, Approved, or "Rejected: reason".
function reviewText(observation) {
  if (observation.state === 'Rejected') {
    return 'Rejected: ' + observation.reason;
  }
  return observation.state;
}

// Makes a small photo box. sizeClass is optional: "md" or "big" makes the photo larger.
function makeThumb(photo, altText, sizeClass) {
  const box = document.createElement('span');
  box.className = 'thumbbox';
  if (sizeClass) {
    box.classList.add(sizeClass);
  }
  const img = document.createElement('img');
  img.src = photo;
  img.alt = altText;
  img.onerror = function () {
    img.onerror = null;
    img.src = PICTURE_BLANK;
  };
  box.appendChild(img);
  return box;
}

// Makes the coloured pill that shows a conservation status.
function makePill(status) {
  const pill = document.createElement('span');
  pill.className = statusClass(status);
  pill.textContent = status;
  return pill;
}

// Makes a table cell (<td>) that shows the text.
function makeCell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

// Runs once when the sample data changes (see DATA_VERSION).
// It puts the new sample observations in place and removes species that were created from old observations.
// Species added by the user are kept.
function upgradeOldData() {
  if (readStorage(VERSION_KEY) === DATA_VERSION) {
    return;
  }

  writeStorage(OBSERVATIONS_KEY, makeStartingObservations());

  const saved = readStorage(SPECIES_KEY);
  if (saved !== null) {
    const kept = [];
    for (let i = 0; i < saved.length; i++) {
      if (!saved[i].obsId) {
        kept.push(saved[i]);
      }
    }
    writeStorage(SPECIES_KEY, kept);
  }

  writeStorage(VERSION_KEY, DATA_VERSION);
}

loadFromDatabase();

upgradeOldData();

guardPages();

showRememberedToast();
