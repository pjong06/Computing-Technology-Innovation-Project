// shared.js - the saved data, the left menu and small helpers used by every page.

const SPECIES_KEY = 'niah_species';
const OBSERVATIONS_KEY = 'niah_observations';
const USERS_KEY = 'niah_users';
const EDIT_KEY = 'niah_editing';
const TOAST_KEY = 'niah_toast';
const VERSION_KEY = 'niah_data_version';
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

// Reads a saved value from the browser's localStorage. Returns null if nothing is saved.
function readStorage(key) {
  const text = localStorage.getItem(key);
  if (text === null) {
    return null;
  }
  return JSON.parse(text);
}

// Saves a value in localStorage. Returns true if it worked, false if the browser is full.
function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    return false;
  }
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
function makeStartingUsers() {
  return [
    { name: 'Brendan Noel', email: 'brendan@sfc.example', role: 'Botanist', active: true },
    { name: 'Aina Rahman', email: 'aina@sfc.example', role: 'Botanist', active: true },
    { name: 'Daniel Ling', email: 'daniel@sfc.example', role: 'Conservation Officer', active: true },
    { name: 'Mei Tan', email: 'mei@sfc.example', role: 'Administrator', active: false }
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

// Returns the saved list of users (the sample ones the first time).
function getUsers() {
  let list = readStorage(USERS_KEY);
  if (list === null) {
    list = makeStartingUsers();
    writeStorage(USERS_KEY, list);
  }
  return list;
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

  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = 'Conservation Officer · Web';
  nav.appendChild(sub);

  for (let i = 0; i < MENU.length; i++) {
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
  who.textContent = 'Conservation Officer portal';
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

upgradeOldData();

showRememberedToast();
