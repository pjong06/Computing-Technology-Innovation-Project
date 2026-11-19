// shared.js - the saved data, the left menu and small helpers used by every page.


// Connection to Supabase and the backend
// The publishable key is meant to be public. NEVER put a service_role key here.
const SUPABASE_URL = 'https://yzhxjzbzslnveskkwvfy.supabase.co';
const SUPABASE_KEY = 'sb_publishable_4L1RojeFv6wLAsFNX2q3KQ_hjanSuTo';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { storageKey: 'niah_supabase_auth' } });
window.sb = sb;

const SESSION_EXPIRED_MESSAGE = 'Your session expired, please log in again.';

// Gives back a login token that is still valid, or null if nobody is logged in or the
// login can't be renewed. A token that runs out within a minute is renewed first, so a
// request never leaves with a token that expires on the way.
window.getOfficerAccessToken = async function () {
  const result = await sb.auth.getSession();
  let session = result.data.session;
  if (!session) {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at && session.expires_at - 60 <= now) {
    const renewed = await sb.auth.refreshSession();
    if (renewed.error || !renewed.data.session) {
      return null;
    }
    session = renewed.data.session;
  }
  return session.access_token;
};

// The login can't be renewed: forget it and go to the login page, which shows why.
// On the login page itself nothing happens (the page shows its own error).
async function sendToLoginExpired() {
  if (OPEN_PAGES.indexOf(thisPageName()) !== -1) {
    return;
  }
  localStorage.removeItem(SESSION_KEY);
  rememberToast(SESSION_EXPIRED_MESSAGE);
  try {
    await sb.auth.signOut({ scope: 'local' });
  } catch (error) {
    // Already signed out: nothing to undo.
  }
  location.replace('login.html');
}

const SERVER_UNREACHABLE_MESSAGE = 'Could not reach the server. Check your connection and try again.';

// Calls the backend with the officer's login token. If the backend says the token is no
// longer valid (401), the login is renewed once and the request sent again; if that
// fails too, the person is sent to the login page.
async function api(path, options) {
  options = options || {};

  async function send(token) {
    // A photo upload (FormData) sets its own content type; everything else is JSON.
    const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const headers = Object.assign(isForm ? {} : { 'Content-Type': 'application/json' }, options.headers);
    if (token) {
      headers.Authorization = 'Bearer ' + token;
    }
    try {
      return await fetch('/api' + path, Object.assign({}, options, { headers: headers }));
    } catch (error) {
      // No answer at all (offline, server down): the browser's own text is "Failed to fetch".
      console.error('Request to /api' + path + ' failed:', error);
      throw new Error(SERVER_UNREACHABLE_MESSAGE);
    }
  }

  let response = await send(await window.getOfficerAccessToken());
  if (response.status === 401) {
    // A 401 means the request was refused before it did anything, so sending it again is safe.
    const renewed = await sb.auth.refreshSession();
    if (!renewed.error && renewed.data.session) {
      response = await send(renewed.data.session.access_token);
    }
    if (response.status === 401) {
      await sendToLoginExpired();
      throw new Error(SESSION_EXPIRED_MESSAGE);
    }
  }

  const body = await response.json().catch(function () { return {}; });
  if (response.ok === false) {
    throw new Error(body.message || ('Request failed (' + response.status + ')'));
  }
  return body;
}

// ---------- The real species catalogue (/api/knowledge) ----------
// The same species table the mobile app reads. Officers manage it; botanists propose.

// Conservation status as stored in species.conservation_status (IUCN codes), with the
// words the pages show. An empty status is "Not assessed".
const STATUS_LABELS = {
  CR: 'Critically Endangered',
  EN: 'Endangered',
  VU: 'Vulnerable',
  NT: 'Near Threatened',
  LC: 'Least Concern',
  DD: 'Data Deficient'
};
const NOT_ASSESSED = 'Not assessed';

// The words for a stored status. Older rows that already hold the words keep them.
function statusLabel(code) {
  if (!code) {
    return NOT_ASSESSED;
  }
  return STATUS_LABELS[code] || code;
}

// Reads every page of a paged list (?page=&page_size=100) and returns all the rows.
async function fetchAllPages(path) {
  const joiner = path.indexOf('?') === -1 ? '?' : '&';
  let rows = [];
  let page = 1;
  let totalPages = 1;
  do {
    const result = await api(path + joiner + 'page=' + page + '&page_size=100');
    rows = rows.concat(result.data || []);
    totalPages = result.pagination ? result.pagination.total_pages : 1;
    page = page + 1;
  } while (page <= totalPages);
  return rows;
}

// Every taxonomy row (family and genus). Used for the Family box and to link a species.
async function loadTaxonomy() {
  return fetchAllPages('/knowledge/taxonomy');
}

// The taxonomy row for this family, using the genus (first word of the scientific name).
// Creates it when it doesn't exist yet. Returns its id, or null when no family is given.
async function taxonomyIdFor(taxonomy, family, scientificName) {
  const wantedFamily = family.trim();
  if (wantedFamily === '') {
    return null;
  }
  const genus = scientificName.trim().split(/\s+/)[0];
  const same = function (a, b) { return String(a || '').toLowerCase() === String(b || '').toLowerCase(); };
  for (let i = 0; i < taxonomy.length; i++) {
    if (same(taxonomy[i].family, wantedFamily) && same(taxonomy[i].genus, genus)) {
      return taxonomy[i].id;
    }
  }
  try {
    const created = await api('/knowledge/taxonomy', {
      method: 'POST',
      body: JSON.stringify({ kingdom: 'Plantae', family: wantedFamily, genus: genus })
    });
    taxonomy.push(created.data);
    return created.data.id;
  } catch (error) {
    // Made at the same moment by someone else: read the list again and use theirs.
    const fresh = await loadTaxonomy();
    for (let i = 0; i < fresh.length; i++) {
      if (same(fresh[i].family, wantedFamily) && same(fresh[i].genus, genus)) {
        return fresh[i].id;
      }
    }
    throw error;
  }
}

const SPECIES_PHOTO_LICENSES = {
  'cc-by': 'CC BY',
  'cc-by-sa': 'CC BY-SA',
  cc0: 'CC0'
};

function preferredSpeciesPhoto(photos) {
  if (!Array.isArray(photos) || photos.length === 0) return null;
  return photos.find(photo => photo.source === 'sfc' && photo.is_primary) ||
    photos.find(photo => photo.source === 'sfc') ||
    photos.find(photo => photo.is_primary) ||
    photos[0];
}

// A one-minute signed link and safe attribution details for the species' preferred photo.
async function speciesPhoto(species) {
  const chosen = preferredSpeciesPhoto(species.species_media);
  if (!chosen) return null;
  const result = await api('/knowledge/species/' + species.id + '/photos/' + chosen.id);
  return { ...chosen, ...result };
}

// ---- photo credit (same logic as niah-biotrack/src/utils/photoCredit.ts) ----
// The plain-text credit under an iNaturalist reference photo:
//   "Photo: <name>, <licence> via iNaturalist"
// backend/test/photoCredit.test.js runs this code and the app's copy on the same examples.

// The photographer's name from iNaturalist's credit sentence, or '' when it has none.
//   "(c) Samuel Frankel, some rights reserved (CC BY), uploaded by Samuel Frankel" -> "Samuel Frankel"
//   "no rights reserved, uploaded by Meng-Ying Tsai" (CC0) -> "Meng-Ying Tsai"
//   "Jane Doe" -> "Jane Doe";  "no rights reserved" -> ""
function nameFromAttribution(text) {
  const value = String(text ?? '').trim();
  if (!value) return '';

  const copyright = /^(?:\(c\)|©)\s*/i.exec(value);
  if (copyright) return value.slice(copyright[0].length).split(',')[0].trim();

  const uploadedAt = value.toLowerCase().indexOf('uploaded by ');
  if (uploadedAt !== -1) return value.slice(uploadedAt + 'uploaded by '.length).split(',')[0].trim();

  const first = value.split(',')[0].trim();
  return first.toLowerCase().includes('rights reserved') ? '' : first;
}

// The name to show: the photographer field, otherwise the name inside the attribution.
// A photographer field that holds a whole credit sentence is cleaned the same way.
function photoCreditName(photo) {
  const photographer = String(photo.photographer ?? '').trim();
  const fromPhotographer = /^(?:\(c\)|©)/i.test(photographer)
    ? nameFromAttribution(photographer)
    : photographer;
  return fromPhotographer || nameFromAttribution(photo.attribution) || 'Unknown photographer';
}

function photoCreditText(photo) {
  const licence = (photo.licence_code && SPECIES_PHOTO_LICENSES[photo.licence_code]) || 'Unknown licence';
  return `Photo: ${photoCreditName(photo)}, ${licence} via iNaturalist`;
}
// ---- end photo credit ----

function makeSpeciesPhotoCredit(photo, compact) {
  if (!photo || photo.source !== 'inaturalist') return null;

  // Plain text, never the whole attribution sentence.
  const fullCredit = photoCreditText(photo);
  const credit = document.createElement('div');
  credit.className = 'species-photo-credit' + (compact ? ' compact' : '');
  credit.title = fullCredit;
  credit.setAttribute('aria-label', fullCredit);
  credit.textContent = fullCredit;
  return credit;
}

// Opens the species editor for this species id, or for a new species when id is ''.
function openSpeciesEditor(id) {
  writeStorage(EDIT_KEY, id || '');
  location.href = 'editor.html';
}


const USERS_KEY = 'niah_users';
const EDIT_KEY = 'niah_editing';
const TOAST_KEY = 'niah_toast';
const SESSION_KEY = 'niah_session';
const SUSPENDED_ACCOUNT_MESSAGE =
  'Your account is suspended. Contact your system administrator.';

// Turns the text of an SVG drawing into an image address that an <img> tag can show.
function svgPicture(svg) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

const PICTURE_BLANK = svgPicture('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><rect width="56" height="56" fill="#6aa05a"/><path d="M10 46C10 22 26 8 46 10 46 32 34 46 10 46z" fill="#2f6b3a"/><path d="M12 44L38 18" stroke="#a9d49a" stroke-width="2"/></svg>');

// User administration is stored in website_users; page state stays in this browser.
const DATABASE_KEYS = [USERS_KEY];
const AUTH_STORAGE_KEY = 'niah_supabase_auth';
const NOT_LOGGED_IN = 'You are not logged in.';
let databaseCache = {};     // the saved values, as text, loaded when the page opens
let databaseReady = false;  // true when the values were loaded from the database
let databaseProblem = '';   // the reason the database could not be used, if any
let databaseSaved = {};     // what each list looked like when it was last loaded or saved
let databaseIds = {};       // the ids each list had when it was last loaded or saved
let databasePrints = {};    // a fingerprint of each record (by id) when its list was last loaded or saved

// text = [name used by the page, column in the table]
// flags = [name used by the page, column] for yes/no values
const LIST_TABLES = [
  {
    key: USERS_KEY,
    text: [['name', 'name'], ['username', 'username'], ['email', 'email'], ['role', 'role']],
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

// Turns a user item into a database row. Unmapped fields are preserved in "extra".
function itemToRow(item, table) {
  const row = { id: item.id };
  const used = { id: true, passwordHash: true };

  for (let i = 0; i < table.text.length; i++) {
    const value = item[table.text[i][0]];
    row[table.text[i][1]] = (value === undefined || value === null) ? '' : String(value);
    used[table.text[i][0]] = true;
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

// Turns one user row back into an item used by the page.
function rowToItem(row, table) {
  const item = Object.assign({}, row.extra || {});
  item.id = row.id;

  for (let i = 0; i < table.text.length; i++) {
    const value = row[table.text[i][1]];
    item[table.text[i][0]] = (value === undefined || value === null) ? '' : value;
  }
  for (let i = 0; i < table.flags.length; i++) {
    item[table.flags[i][0]] = row[table.flags[i][1]] !== false;
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
  // Keep what the stored session already had (e.g. the user), so the Supabase library
  // still recognises it, and only replace the renewed tokens.
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(Object.assign({}, session, fresh)));
  return fresh.access_token;
}

// Calls the website-users API and returns { ok, data } or { ok: false, message }.
function databaseRequest(method, body) {
  const token = getTokenNow();
  if (token === null) {
    return { ok: false, message: NOT_LOGGED_IN };
  }
  const request = new XMLHttpRequest();
  request.open(method, '/api/web-data/users', false);
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
  if (request.status === 401) {
    // The backend refused the login token ("Invalid or expired token").
    return { ok: false, message: SESSION_EXPIRED_MESSAGE, expired: true };
  }
  if (request.status < 200 || request.status >= 300) {
    return { ok: false, message: reply.message || ('Database error ' + request.status) };
  }
  return { ok: true, data: reply.data };
}

// Loads website users when a page opens.
function loadFromDatabase() {
  if (OPEN_PAGES.indexOf(thisPageName()) !== -1) {
    return;
  }
  for (let i = 0; i < LIST_TABLES.length; i++) {
    const table = LIST_TABLES[i];
    const listResult = databaseRequest('GET');
    if (listResult.ok === false) {
      databaseProblem = listResult.message;
      if (listResult.message === NOT_LOGGED_IN || listResult.expired) {
        if (readStorage(SESSION_KEY) !== null) {
          rememberToast(SESSION_EXPIRED_MESSAGE);
        }
        localStorage.removeItem(SESSION_KEY);
      }
      return;
    }
    const items = listResult.data.map(function (row) {
      return rowToItem(row, table);
    });
    // Used as it is, also when empty: the pages never add sample records.
    databaseCache[table.key] = JSON.stringify(items);
    databaseSaved[table.key] = listFingerprint(items, table);
    databaseIds[table.key] = idsOf(items);
    databasePrints[table.key] = rowPrints(items, table);
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
  const listResult = databaseRequest('GET');
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

  const table = findListTable(key);
  if (table === null) {
    return false;
  }

  databaseCache[key] = JSON.stringify(value);
  if (databaseReady === false) {
    // The login and password pages do not load database data.
    return OPEN_PAGES.indexOf(thisPageName()) !== -1;
  }

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
  const saved = databaseRequest('PUT', { rows: rows, removed: removed });
  if (saved.ok === false) {
    showToast('Could not save to the database: ' + saved.message);
    return false;
  }

  // The database gives new users their ids. Put the saved records back in the list.
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

// ---- Shared by the approval queue and the rejected list ----

// Returns the observation with this id from the list, or null if there is none.
function findObservation(list, id) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) {
      return list[i];
    }
  }
  return null;
}

// The name to show: the plant's scientific name, or a plain fallback.
function observationName(observation) {
  if (observation.plant && observation.plant.scientific_name) {
    return observation.plant.scientific_name;
  }
  return 'Species not recorded';
}

// "2 Nov 2026, 11:00 AM" for an ISO date, or '' when there is none.
function visitTime(iso) {
  if (!iso) {
    return '';
  }
  return whenText(new Date(iso));
}

// Adds a bold title with a line of text under it to the card.
function addInfo(parent, title, text) {
  const paragraph = document.createElement('p');
  const bold = document.createElement('b');
  bold.textContent = title;
  paragraph.appendChild(bold);
  paragraph.appendChild(document.createElement('br'));
  paragraph.appendChild(document.createTextNode(text));
  parent.appendChild(paragraph);
}

// Makes one small card for an observation list: picture, scientific name, who recorded it
// and when. selected = highlight it. onSelect runs when the card is clicked.
function makeObservationListCard(observation, selected, picture, onSelect) {
  const card = document.createElement('div');
  card.className = 'q';
  if (selected) {
    card.classList.add('on');
  }
  card.onclick = onSelect;

  const bold = document.createElement('b');
  const name = document.createElement('i');
  name.className = 'sci';
  name.textContent = observationName(observation);
  bold.appendChild(name);

  const small = document.createElement('span');
  small.className = 'muted';
  small.textContent = (observation.observer_name || 'Botanist') + ' · ' + visitTime(observation.observed_at);

  const text = document.createElement('div');
  text.appendChild(bold);
  text.appendChild(small);

  const row = document.createElement('div');
  row.className = 'sp';
  row.appendChild(makeThumb(picture, observationName(observation), 'md'));
  row.appendChild(text);
  card.appendChild(row);
  return card;
}

// ---- Review status words and colours (one scheme for the portal and the mobile app) ----
// Waiting for review (blue) · Approved (green) · Needs changes (red) · Draft (grey).
// css is the class for .plant-status / .status-badge in style.css.
const REVIEW_STATUS_DISPLAY = {
  pending: { label: 'Waiting for review', css: 'pending' },
  approved: { label: 'Approved', css: 'approved' },
  rejected: { label: 'Needs changes', css: 'rejected' },
  draft: { label: 'Draft', css: 'draft' }
};
function reviewStatusDisplay(value) {
  const status = String(value || 'unknown').toLowerCase();
  return REVIEW_STATUS_DISPLAY[status] || { label: String(value || 'unknown').replaceAll('_', ' '), css: '' };
}

// ---- Display helpers for plant tags and coordinates ----

// The tag to show on screen. "plant:..." values are placeholders the database gives a plant
// that has no physical tag yet; they are never shown. Real tags (NIAH-PLT-00001) unchanged.
// CSV/PDF exports keep the stored value.
const NO_PHYSICAL_TAG = 'No physical tag yet';
function displayTag(tag, fallback) {
  const value = String(tag ?? '').trim();
  if (value === '') return fallback === undefined ? NO_PHYSICAL_TAG : fallback;
  return /^plant:/i.test(value) ? NO_PHYSICAL_TAG : value;
}

// "3.817612, 113.781045" for display (6 decimals). Stored values and exports are unchanged.
function displayCoordinates(latitude, longitude) {
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
    return 'Not recorded';
  }
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'Not recorded';
  return lat.toFixed(6) + ', ' + lng.toFixed(6);
}

// Starts the big detail card for an observation: its scientific name and plant tag.
function makeObservationDetailCard(observation) {
  const card = document.createElement('div');
  card.className = 'card detail';

  const title = document.createElement('h3');
  title.style.marginTop = '0';
  const name = document.createElement('i');
  name.className = 'sci';
  name.textContent = observationName(observation);
  title.appendChild(name);
  card.appendChild(title);

  const plant = observation.plant || {};
  const record = document.createElement('p');
  record.className = 'muted';
  record.textContent = plant.tag_code ? 'Tag ' + displayTag(plant.tag_code) : 'No tag attached';
  card.appendChild(record);
  return card;
}

// Adds the plant's common name (if any), its location and who recorded the visit, and when.
function addPlantAndRecorder(card, observation) {
  const plant = observation.plant || {};
  if (plant.common_name) {
    addInfo(card, 'Common name', plant.common_name);
  }
  addInfo(card, 'Location', plant.location_description || 'Not recorded');
  addInfo(card, 'Recorded by', (observation.observer_name || 'Botanist') + ', ' + visitTime(observation.observed_at));
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

// Makes a username from the part of an email before the @ sign.
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

// Returns the list of login accounts (website_users; only the officer gets it). Older
// rows without a username get one here, in memory only: reading never writes.
function getUsers() {
  const list = readStorage(USERS_KEY) || [];
  for (let i = 0; i < list.length; i++) {
    if (list[i].username === undefined) {
      list[i].username = makeUsernameFromEmail(list[i].email, list);
    }
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

// Pages that need no login
const OPEN_PAGES = [
  'login.html',
  'forgot-password.html',
  'reset-password.html'
];

// Pages a botanist may open. Officers (and administrators) may open every page.
// The Distribution map and Plant catalogue are not here; their data is officer-only.
const BOTANIST_PAGES = [
  'species.html',
  'editor.html'
];

const OFFICER_ONLY_PAGE_MESSAGE = 'That page is for conservation officers only.';

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
    rememberToast(SUSPENDED_ACCOUNT_MESSAGE);
  }
}

// Sends visitors who are not logged in to the login page,
// and sends botanists away from the pages they may not open (with a message saying why).
// Returns true when this person may stay on this page. Page scripts check pageAllowed
// before calling the backend, so nothing is requested while the browser is leaving.
function guardPages() {
  const file = thisPageName();
  if (OPEN_PAGES.indexOf(file) !== -1) {
    return true;
  }
  const user = getCurrentUser();
  if (user === null) {
    tellIfSuspended();
    location.replace('login.html');
    return false;
  }
  if (canOpen(user, file) === false) {
    rememberToast(OFFICER_ONLY_PAGE_MESSAGE);
    location.replace('species.html');
    return false;
  }
  return true;
}

// ---- Navigation: menu sections, tab bars, review counts and the landing page ----
//
// Officers see five menu sections. A section with more than one page shows a tab bar at the
// top of its pages (drawn here, not in each page's HTML). Botanists only see "Species".
// The species editor is not in the menu: the catalogue's Add species / Edit buttons open it
// (openSpeciesEditor), and "Species" stays highlighted there.
const NAV_SECTIONS = [
  {
    label: 'Review',
    countId: 'review-menu-count',
    pages: [
      { file: 'queue.html', label: 'Field records', countId: 'field-records-count' },
      { file: 'proposals.html', label: 'Species proposals', countId: 'species-proposals-count' },
      { file: 'rejected.html', label: 'Rejected history' }
    ]
  },
  {
    label: 'Species',
    alsoActiveOn: ['editor.html'],
    pages: [
      { file: 'species.html', label: 'Species catalogue' }
    ]
  },
  {
    label: 'Plants',
    carrySpecies: true,
    pages: [
      { file: 'plants.html', label: 'List', alsoActiveOn: ['plant.html'] },
      { file: 'map.html', label: 'Map' }
    ]
  },
  {
    label: 'IoT alerts',
    pages: [
      { file: 'alerts.html', label: 'IoT alerts' }
    ]
  },
  {
    label: 'Admin',
    pages: [
      { file: 'reports.html', label: 'Reports' },
      { file: 'users.html', label: 'Users' }
    ]
  }
];

// Every page reachable from the menu or a tab bar, in order.
const MENU = NAV_SECTIONS.reduce((all, section) => all.concat(section.pages), []);

function pageMatches(page, file) {
  return page.file === file || (page.alsoActiveOn || []).indexOf(file) !== -1;
}

// "?species=<id>" when the current address has one, so Plants List <-> Map keeps the filter.
function speciesQuery(search) {
  const id = new URLSearchParams(search || '').get('species');
  return id ? '?species=' + encodeURIComponent(id) : '';
}

// What the menu and tab bar show for this person on this page (no page drawing here).
// Returns { sections: [{ label, href, active, countId }], tabs: [{ label, href, active, countId }] }.
// Only pages the person may open are included, so no section is ever empty.
function navFor(user, activeFile, search) {
  const sections = [];
  let tabs = [];
  for (const section of NAV_SECTIONS) {
    const pages = section.pages.filter(page => user === null || canOpen(user, page.file));
    if (pages.length === 0) {
      continue;
    }
    const activePage = pages.find(page => pageMatches(page, activeFile)) || null;
    const active = activePage !== null || (section.alsoActiveOn || []).indexOf(activeFile) !== -1;
    sections.push({
      label: section.label,
      href: pages[0].file,
      active: active,
      countId: section.countId || null
    });
    if (activePage !== null && pages.length > 1) {
      const query = section.carrySpecies ? speciesQuery(search) : '';
      tabs = pages.map(page => ({
        label: page.label,
        href: page.file + query,
        active: page === activePage,
        countId: page.countId || null
      }));
    }
  }
  return { sections: sections, tabs: tabs };
}

// ---- Waiting-for-review counts (officers only) ----
// Field records: GET /api/reports/summary (officer-only), pending_observation_count.
// Species proposals: the existing pending-proposals call. The Review menu entry shows the sum.
const reviewCounts = { records: null, proposals: null };

function validCount(count, what) {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('The ' + what + ' count was unavailable.');
  }
  return count;
}

async function fetchFieldRecordsCount() {
  const result = await api('/reports/summary');
  return validCount(result?.data?.pending_observation_count, 'field records');
}

async function fetchSpeciesProposalCount() {
  const result = await api('/knowledge/species/proposals/pending?page=1&page_size=1');
  return validCount(result?.pagination?.total, 'pending proposal');
}

// ---- Landing page after login ----
// Officers: the review page when anything waits for review, otherwise the map.
// Botanists: the species catalogue. If the counts don't arrive quickly (or fail), officers
// go to the species catalogue, so logging in is never held up.
const HOME_COUNT_TIMEOUT_MS = 2500;

async function homePageFor(user) {
  if (user === null || isBotanist(user)) {
    return 'species.html';
  }
  try {
    const counts = Promise.all([fetchFieldRecordsCount(), fetchSpeciesProposalCount()]);
    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('The review counts took too long.')), HOME_COUNT_TIMEOUT_MS);
    });
    const [records, proposals] = await Promise.race([counts, timeout]).finally(() => clearTimeout(timer));
    return records + proposals > 0 ? 'queue.html' : 'map.html';
  } catch (error) {
    console.warn('Landing page counts unavailable; opening the species catalogue.', error);
    return 'species.html';
  }
}

// Opens the first page after logging in (see homePageFor).
async function goToHome() {
  location.href = await homePageFor(getCurrentUser());
}

// ---- end of navigation ----

// Shows a warning at the top of the page when the database could not be loaded, so an
// empty page is never mistaken for "no data".
function showDatabaseProblem() {
  if (databaseProblem === '' || OPEN_PAGES.indexOf(thisPageName()) !== -1) {
    return;
  }
  const main = document.querySelector('main');
  if (main === null || document.getElementById('database-problem') !== null) {
    return;
  }
  const box = document.createElement('div');
  box.id = 'database-problem';
  box.className = 'card';
  box.setAttribute('role', 'alert');
  box.textContent = 'Could not load data from the database: ' + databaseProblem +
    '. What you see may be incomplete. Reload the page to try again.';
  main.insertBefore(box, main.firstChild);
}

// A small count badge (hidden until a count arrives, and at 0).
function makeCountBadge(id) {
  const badge = document.createElement('span');
  badge.id = id;
  badge.className = 'menu-count';
  badge.hidden = true;
  return badge;
}

// Builds the left menu inside <nav id="menu"> and highlights the section of this page
// (activeFile). Pages in a section with more than one page also get a tab bar at the top
// of <main>.
function drawMenu(activeFile) {
  const nav = document.getElementById('menu');
  if (nav === null) {
    return;
  }
  showDatabaseProblem();

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

  const view = navFor(user, activeFile, location.search);
  for (const section of view.sections) {
    const link = document.createElement('a');
    link.href = section.href;
    link.appendChild(document.createTextNode(section.label));
    if (section.countId) {
      link.appendChild(makeCountBadge(section.countId));
    }
    if (section.active) {
      link.className = 'on';
      link.setAttribute('aria-current', 'page');
    }
    nav.appendChild(link);
  }

  drawSectionTabs(view.tabs);

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
  out.onclick = function () {
    logout().catch(showUnexpectedError);
  };
  who.appendChild(out);
  nav.appendChild(who);

  // Waiting-for-review counts, for officers. The proposals and field records pages set their
  // own count after loading their list.
  if (user !== null && isBotanist(user) === false) {
    if (thisPageName() !== 'proposals.html') {
      refreshSpeciesProposalMenuCount().catch(error => {
        showToast('Pending proposal count could not be loaded. ' + error.message);
      });
    }
    if (thisPageName() !== 'queue.html') {
      refreshFieldRecordsCount().catch(error => {
        showToast('Field record count could not be loaded. ' + error.message);
      });
    }
  }
}

// The tab bar for a section with more than one page (e.g. Review: Field records · Species
// proposals · Rejected history), at the top of <main>. Not a <nav> element: the menu's
// nav styles would apply to it.
function drawSectionTabs(tabs) {
  const main = document.querySelector('main');
  if (main === null || tabs.length === 0 || document.getElementById('section-tabs') !== null) {
    return;
  }
  const bar = document.createElement('div');
  bar.id = 'section-tabs';
  bar.className = 'section-tabs';
  bar.setAttribute('role', 'navigation');
  bar.setAttribute('aria-label', 'Pages in this section');
  for (const tab of tabs) {
    const link = document.createElement('a');
    link.href = tab.href;
    link.appendChild(document.createTextNode(tab.label));
    if (tab.countId) {
      link.appendChild(makeCountBadge(tab.countId));
    }
    if (tab.active) {
      link.className = 'on';
      link.setAttribute('aria-current', 'page');
    }
    bar.appendChild(link);
  }
  main.insertBefore(bar, main.firstChild);
}

// Shows a count on a badge (hidden at 0). noun is singular, e.g. "pending species proposal".
function setCountBadge(id, count, noun) {
  const badge = document.getElementById(id);
  if (!badge) return;
  badge.textContent = String(count);
  badge.hidden = count === 0;
  badge.title = count + ' ' + noun + (count === 1 ? '' : 's');
  badge.setAttribute('aria-label', badge.title);
}

// The Review menu entry: field records + species proposals waiting.
function updateReviewMenuCount() {
  if (reviewCounts.records === null && reviewCounts.proposals === null) return;
  setCountBadge('review-menu-count', (reviewCounts.records || 0) + (reviewCounts.proposals || 0),
    'item waiting for review');
}

function updateSpeciesProposalMenuCount(count) {
  reviewCounts.proposals = validCount(count, 'pending proposal');
  setCountBadge('species-proposals-count', count, 'pending species proposal');
  updateReviewMenuCount();
}

function updateFieldRecordsCount(count) {
  reviewCounts.records = validCount(count, 'field records');
  setCountBadge('field-records-count', count, 'field record waiting for review');
  updateReviewMenuCount();
}

async function refreshSpeciesProposalMenuCount() {
  updateSpeciesProposalMenuCount(await fetchSpeciesProposalCount());
}

async function refreshFieldRecordsCount() {
  updateFieldRecordsCount(await fetchFieldRecordsCount());
}

// Hides the small pop-up message.
function hideToast() {
  const toast = document.getElementById('toast');
  if (toast) {
    toast.classList.remove('on');
  }
}

// Shows a small pop-up message for a few seconds.
// Shows an error that a background task did not handle itself, so a failure is never
// silent. Used as .catch(showUnexpectedError) where a promise is started but not awaited.
function showUnexpectedError(error) {
  const detail = error && error.message ? error.message : String(error);
  showToast('Something went wrong: ' + detail);
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (toast === null) {
    return;
  }
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

// Returns the CSS class of the coloured pill for a conservation status.
function statusClass(status) {
  if (status === 'Endangered' || status === 'Critically Endangered') {
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
  const lat = Number.parseFloat(parts[0]);
  const lng = Number.parseFloat(parts[1]);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
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

loadFromDatabase();

const pageAllowed = guardPages();

showRememberedToast();
