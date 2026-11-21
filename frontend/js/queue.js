// queue.js - Review > Field records: the officer checks field records before they become
// official. Real data from GET /api/officer/reviews/pending (with plant, species, botanist,
// GPS, previous visit and a list thumbnail); the decision is saved with
// POST /api/officer/reviews/:id/decision. Approved records show on the plant pages; records
// sent back appear in Rejected history with the reason, and the botanist fixes them in the app.
//
// Layout: the list on the left (newest first, the first 6, then "Show N older records"),
// the selected record on the right, with the decision at the bottom. Under 1000 px the
// list is on top and the record below.

drawMenu('queue.html');

const FIRST_ROWS = 6;

let pending = [];        // the records waiting for review, as the backend sent them
let selectedId = null;
let photosById = {};     // short-lived photo links for each record, once loaded
let chosenPhoto = {};    // which photo is shown large, per record
let busy = false;        // a decision is being saved
let sortOrder = SORT_NEWEST; // newest field record first; the select switches it
let showAll = false;     // "Show N older records" pressed
let reviewMap = null;    // the small Leaflet map in the detail card
const reasonDrafts = {}; // a reason typed for a record, kept while switching records
let sendBackOpenFor = null; // the record whose "Send back" reason box is open

// The tabs (Field records · Species proposals · Rejected history, with counts) go under the
// page heading and its description.
(function placeSectionTabs() {
  const tabs = document.getElementById('section-tabs');
  const header = document.getElementById('queue-header');
  if (tabs && header) header.insertAdjacentElement('afterend', tabs);
})();

// ---- Words ----

// "New plant" only for the plant's first record (its registration); every later record of
// the same plant is an "Observation", even while the plant is still waiting for approval.
// The pending API says which is which (is_first_record); without it, a pending plant counts
// as new.
function visitKind(observation) {
  if (observation.is_first_record === true) return 'New plant';
  if (observation.is_first_record === false) return 'Observation';
  return observation.plant?.plant_status === 'pending' ? 'New plant' : 'Observation';
}

function visitKindBadge(observation) {
  const label = document.createElement('span');
  label.className = 'review-type ' + (visitKind(observation) === 'New plant' ? 'new-plant' : 'observation');
  label.textContent = visitKind(observation).toUpperCase();
  return label;
}

function statusBadge(value) {
  const status = reviewStatusDisplay(value);
  const badge = document.createElement('span');
  badge.className = ('status-badge ' + status.css).trim();
  badge.textContent = status.label;
  return badge;
}

// "Today 09:42", "Yesterday 16:20", otherwise "19 Nov 15:30" (with the year when it isn't
// this year).
function reviewTime(value, now) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Time not recorded';
  const today = now || new Date();
  const time = twoDigits(date.getHours()) + ':' + twoDigits(date.getMinutes());
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(today) - startOfDay(date)) / 86400000);
  if (days === 0) return 'Today ' + time;
  if (days === 1) return 'Yesterday ' + time;
  const day = date.getDate() + ' ' + MONTHS[date.getMonth()];
  return (date.getFullYear() === today.getFullYear() ? day : day + ' ' + date.getFullYear()) + ' ' + time;
}

// "12 Nov" (with the year when it isn't this year).
function shortDay(value, now) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const today = now || new Date();
  const day = date.getDate() + ' ' + MONTHS[date.getMonth()];
  return date.getFullYear() === today.getFullYear() ? day : day + ' ' + date.getFullYear();
}

// Stored in cm: height in metres, diameter in cm.
function heightText(heightCm) {
  return heightCm === null || heightCm === undefined || !Number.isFinite(Number(heightCm))
    ? '—' : Math.round(Number(heightCm)) / 100 + ' m';
}

function diameterText(diameterCm) {
  return diameterCm === null || diameterCm === undefined || !Number.isFinite(Number(diameterCm))
    ? '—' : Math.round(Number(diameterCm) * 100) / 100 + ' cm';
}

// "healthy" -> "Healthy", "seedling_sapling" -> "Seedling sapling".
function plainValue(value) {
  const text = String(value || '').replaceAll('_', ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '—';
}

function botanistName(observation) {
  return observation.observer_name || 'Botanist';
}

function tagText(observation) {
  return displayTag(observation.plant?.tag_code, 'No tag yet');
}

// ---- The list ----

function makeRow(observation) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'review-row' + (observation.id === selectedId ? ' selected' : '');
  row.setAttribute('aria-pressed', observation.id === selectedId ? 'true' : 'false');
  row.dataset.id = observation.id;

  // The real photo (signed with the list), or the placeholder.
  const photos = photosById[observation.id];
  const image = document.createElement('img');
  image.alt = '';
  image.loading = 'lazy';
  image.src = (photos && photos.length > 0 && photos[0].url) || observation.thumbnail_url || PICTURE_BLANK;
  image.onerror = function () {
    image.onerror = null;
    image.src = PICTURE_BLANK;
  };
  row.appendChild(image);

  const text = document.createElement('div');
  text.className = 'review-row-text';
  const top = document.createElement('div');
  top.className = 'review-row-top';
  top.appendChild(visitKindBadge(observation));
  top.appendChild(statusBadge(observation.review_status));
  text.appendChild(top);

  const tag = document.createElement('div');
  tag.className = 'review-tag';
  tag.textContent = tagText(observation);
  text.appendChild(tag);

  const sci = document.createElement('div');
  sci.className = 'review-sci';
  sci.textContent = observationName(observation);
  text.appendChild(sci);

  const meta = document.createElement('div');
  meta.className = 'review-meta';
  meta.textContent = botanistName(observation) + ' · ' + reviewTime(observation.observed_at);
  text.appendChild(meta);
  row.appendChild(text);

  row.onclick = function () {
    selectedId = observation.id;
    drawQueue();
  };
  return row;
}

// ---- The selected record ----

function addTile(box, label, value) {
  const tile = document.createElement('div');
  tile.className = 'review-tile';
  const name = document.createElement('div');
  name.className = 'tile-label';
  name.textContent = label;
  const shown = document.createElement('div');
  shown.className = 'tile-value';
  shown.textContent = value;
  tile.appendChild(name);
  tile.appendChild(shown);
  box.appendChild(tile);
}

function addSection(card, title, text) {
  if (!text || !String(text).trim()) return;
  const section = document.createElement('div');
  section.className = 'review-section';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const body = document.createElement('p');
  body.textContent = String(text).trim();
  section.appendChild(heading);
  section.appendChild(body);
  card.appendChild(section);
}

// Shows a photo full size over the page. Esc, a click anywhere or the close button closes it.
function openPhotoOverlay(src, alt) {
  closePhotoOverlay();
  const overlay = document.createElement('div');
  overlay.id = 'photo-overlay';
  overlay.className = 'photo-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', alt);
  const image = document.createElement('img');
  image.src = src;
  image.alt = alt;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'photo-overlay-close';
  close.setAttribute('aria-label', 'Close photo');
  close.textContent = '×';
  overlay.appendChild(image);
  overlay.appendChild(close);
  overlay.onclick = closePhotoOverlay;
  document.body.appendChild(overlay);
  document.addEventListener('keydown', photoOverlayKey);
  close.focus();
}

function closePhotoOverlay() {
  const overlay = document.getElementById('photo-overlay');
  if (overlay) overlay.remove();
  document.removeEventListener('keydown', photoOverlayKey);
}

function photoOverlayKey(event) {
  if (event.key === 'Escape') closePhotoOverlay();
}

// The photo (no credit), with small thumbnails to switch when there are several (the
// selected one outlined). Clicking the photo opens it full size.
function addPhotos(card, observation) {
  const photos = (photosById[observation.id] || []).filter(photo => photo.url);
  const index = Math.min(chosenPhoto[observation.id] || 0, Math.max(photos.length - 1, 0));
  const src = (photos[index] && photos[index].url) || observation.thumbnail_url || null;
  const large = document.createElement('img');
  large.className = 'review-photo';
  large.alt = 'Photo of ' + observationName(observation);
  large.src = src || PICTURE_BLANK;
  large.onerror = function () {
    large.onerror = null;
    large.src = PICTURE_BLANK;
    large.classList.remove('can-open');
    large.onclick = null;
  };
  if (src) {
    // A real photo opens full size (the placeholder doesn't).
    large.classList.add('can-open');
    large.tabIndex = 0;
    large.setAttribute('role', 'button');
    large.title = 'Show full size';
    large.onclick = function () {
      openPhotoOverlay(large.src, large.alt);
    };
    large.onkeydown = function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openPhotoOverlay(large.src, large.alt);
      }
    };
  }
  card.appendChild(large);

  if (photosById[observation.id] === null) {
    const failed = document.createElement('p');
    failed.className = 'muted';
    failed.textContent = 'The photos could not be loaded.';
    card.appendChild(failed);
  }
  if (photos.length > 1) {
    const strip = document.createElement('div');
    strip.className = 'review-thumbs';
    photos.forEach((photo, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = i === index ? 'on' : '';
      button.setAttribute('aria-label', 'Show photo ' + (i + 1) + ' of ' + photos.length);
      const thumb = document.createElement('img');
      thumb.src = photo.url;
      thumb.alt = '';
      button.appendChild(thumb);
      button.onclick = function () {
        chosenPhoto[observation.id] = i;
        drawQueue();
      };
      strip.appendChild(button);
    });
    card.appendChild(strip);
  }
}

// The small map with the plant's pin on the left, "GPS lat, lng · ±accuracy m" on the right.
function addMap(card, observation) {
  const plant = observation.plant || {};
  const hasPoint = Number.isFinite(Number(plant.latitude)) && Number.isFinite(Number(plant.longitude)) &&
    plant.latitude !== null && plant.longitude !== null;
  const section = document.createElement('div');
  section.className = 'review-map-row';
  if (hasPoint && typeof L !== 'undefined') {
    const mapBox = document.createElement('div');
    mapBox.id = 'review-map';
    section.appendChild(mapBox);
  } else {
    section.classList.add('no-map');
  }
  const gps = document.createElement('p');
  gps.className = 'review-gps';
  if (hasPoint) {
    const accuracy = Number.isFinite(Number(plant.gps_accuracy_m)) && plant.gps_accuracy_m !== null
      ? ' · ±' + Math.round(Number(plant.gps_accuracy_m)) + ' m' : '';
    gps.textContent = 'GPS ' + displayCoordinates(plant.latitude, plant.longitude) + accuracy;
  } else {
    gps.textContent = 'GPS location not recorded.';
  }
  section.appendChild(gps);
  card.appendChild(section);
}

function drawMap(observation) {
  if (reviewMap) {
    reviewMap.remove();
    reviewMap = null;
  }
  const mapBox = document.getElementById('review-map');
  if (!mapBox || typeof L === 'undefined') return;
  const point = [Number(observation.plant.latitude), Number(observation.plant.longitude)];
  reviewMap = L.map(mapBox, { scrollWheelZoom: false }).setView(point, 17);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri'
  }).addTo(reviewMap);
  L.marker(point).addTo(reviewMap);
}

// Approve (one click, never needs a reason) and Send back. Send back first opens a box for
// the reason, with "Confirm send back" and "Cancel"; confirming with no reason shows an
// inline error and sends nothing. Cancel closes the box and clears the text.
function addActions(card, observation) {
  const actions = document.createElement('div');
  actions.className = 'review-actions';
  const open = sendBackOpenFor === observation.id;

  const approveButton = document.createElement('button');
  approveButton.className = 'btn';
  approveButton.type = 'button';
  approveButton.textContent = 'Approve';
  approveButton.disabled = busy;
  approveButton.onclick = function () {
    reviewObservation(observation.id, 'approved', null).catch(showUnexpectedError);
  };

  const sendBackButton = document.createElement('button');
  sendBackButton.className = 'btn danger-outline';
  sendBackButton.type = 'button';
  sendBackButton.id = 'send-back-button';
  sendBackButton.textContent = 'Send back';
  sendBackButton.disabled = busy;
  sendBackButton.hidden = open;

  const buttons = document.createElement('div');
  buttons.className = 'acts';
  buttons.appendChild(approveButton);
  buttons.appendChild(sendBackButton);
  actions.appendChild(buttons);

  // The reason box, hidden until Send back is pressed.
  const box = document.createElement('div');
  box.className = 'send-back-box';
  box.id = 'send-back-box';
  box.hidden = !open;

  const label = document.createElement('label');
  label.textContent = 'Reason for sending back';
  const reason = document.createElement('textarea');
  reason.id = 'review-reason';
  reason.maxLength = 2000;
  reason.value = reasonDrafts[observation.id] || '';
  label.appendChild(reason);
  box.appendChild(label);

  const error = document.createElement('p');
  error.className = 'review-error';
  error.id = 'review-reason-error';
  error.setAttribute('role', 'alert');
  error.textContent = 'Tell the botanist what to fix';
  error.hidden = true;
  box.appendChild(error);

  reason.oninput = function () {
    reasonDrafts[observation.id] = reason.value;
    if (reason.value.trim()) error.hidden = true;
  };

  const confirmButton = document.createElement('button');
  confirmButton.className = 'btn red';
  confirmButton.type = 'button';
  confirmButton.textContent = 'Confirm send back';
  confirmButton.disabled = busy;
  confirmButton.onclick = function () {
    const typed = reason.value.trim();
    if (typed === '') {
      error.hidden = false;
      reason.focus();
      return;
    }
    reviewObservation(observation.id, 'rejected', typed).catch(showUnexpectedError);
  };

  const cancelButton = document.createElement('button');
  cancelButton.className = 'btn ghost';
  cancelButton.type = 'button';
  cancelButton.textContent = 'Cancel';
  cancelButton.disabled = busy;
  cancelButton.onclick = function () {
    sendBackOpenFor = null;
    delete reasonDrafts[observation.id];
    reason.value = '';
    error.hidden = true;
    box.hidden = true;
    sendBackButton.hidden = false;
    sendBackButton.focus();
  };

  const boxButtons = document.createElement('div');
  boxButtons.className = 'acts';
  boxButtons.appendChild(confirmButton);
  boxButtons.appendChild(cancelButton);
  box.appendChild(boxButtons);
  actions.appendChild(box);

  sendBackButton.onclick = function () {
    sendBackOpenFor = observation.id;
    box.hidden = false;
    sendBackButton.hidden = true;
    reason.focus();
  };

  card.appendChild(actions);
}

// The selected record. Top: the photo (left) and the details (right); under 1200 px the
// photo is above the details. Below, full width: the map with the GPS text, then the decision.
function makeDetailCard(observation) {
  const card = document.createElement('div');
  card.className = 'card review-detail';

  const top = document.createElement('div');
  top.className = 'review-top';
  const media = document.createElement('div');
  media.className = 'review-media';
  addPhotos(media, observation);
  top.appendChild(media);

  const info = document.createElement('div');
  info.className = 'review-info';

  const title = document.createElement('div');
  title.className = 'review-title';
  const name = document.createElement('h2');
  name.textContent = observationName(observation);
  title.appendChild(name);
  title.appendChild(statusBadge(observation.review_status));
  info.appendChild(title);

  const subline = document.createElement('div');
  subline.className = 'review-subline';
  subline.textContent = [visitKind(observation), tagText(observation), botanistName(observation),
    reviewTime(observation.observed_at)].join(' · ');
  info.appendChild(subline);

  // Two by two; "—" when a value wasn't recorded.
  const tiles = document.createElement('div');
  tiles.className = 'review-tiles';
  addTile(tiles, 'Height (m)', heightText(observation.height_cm).replace(' m', ''));
  addTile(tiles, 'Diameter (cm)', diameterText(observation.diameter_cm).replace(' cm', ''));
  addTile(tiles, 'Health', plainValue(observation.health_status));
  addTile(tiles, 'Life stage', plainValue(observation.life_stage));
  info.appendChild(tiles);

  addSection(info, 'Location note', observation.plant?.location_description);
  addSection(info, 'Morphology', observation.plant?.morphology);
  addSection(info, 'Notes', observation.notes);

  // An observation of a plant already recorded: what was measured last time.
  const previous = observation.previous_observation;
  if (visitKind(observation) === 'Observation' && previous && previous.height_cm !== null &&
      previous.height_cm !== undefined && shortDay(previous.observed_at)) {
    const line = document.createElement('p');
    line.className = 'muted review-previous';
    line.textContent = 'Previous: height ' + heightText(previous.height_cm) + ' on ' + shortDay(previous.observed_at);
    info.appendChild(line);
  }
  top.appendChild(info);
  card.appendChild(top);

  addMap(card, observation);
  addActions(card, observation);
  return card;
}

// ---- Drawing ----

function setCount() {
  const count = document.getElementById('queue-count');
  count.textContent = pending.length + ' field ' + (pending.length === 1 ? 'record' : 'records') +
    ' waiting for review.';
}

// Draws the whole page: the count, the list and the selected record.
function drawQueue() {
  if (pending.length === 0) {
    if (reviewMap) {
      reviewMap.remove();
      reviewMap = null;
    }
    document.getElementById('queue-area').hidden = true;
    document.getElementById('queue-empty').hidden = false;
    document.getElementById('queue-count').textContent = '0 field records waiting for review.';
    return;
  }
  document.getElementById('queue-area').hidden = false;
  document.getElementById('queue-empty').hidden = true;
  setCount();

  addListSortSelect('queue-count', 'queue-sort', function (order) {
    sortOrder = order;
    drawQueue();
  });
  const ordered = sortByDate(pending, item => item.observed_at, sortOrder);

  let selected = findObservation(ordered, selectedId);
  if (selected === null) {
    selected = ordered[0];
    selectedId = selected.id;
  }
  loadPhotos(selected.id).catch(showUnexpectedError);

  // The first 6, then "Show N older records" (the selected record is always shown).
  const selectedIndex = ordered.findIndex(item => item.id === selectedId);
  const visibleCount = showAll ? ordered.length : Math.max(FIRST_ROWS, selectedIndex + 1);
  const listBox = document.getElementById('queue-list');
  listBox.replaceChildren();
  for (const observation of ordered.slice(0, visibleCount)) {
    listBox.appendChild(makeRow(observation));
  }
  const more = document.getElementById('queue-more');
  const hiddenCount = ordered.length - visibleCount;
  more.hidden = hiddenCount <= 0;
  more.textContent = 'Show ' + hiddenCount + (sortOrder === SORT_NEWEST ? ' older' : ' newer') +
    ' record' + (hiddenCount === 1 ? '' : 's');
  more.onclick = function () {
    showAll = true;
    drawQueue();
  };

  const detailBox = document.getElementById('queue-detail');
  detailBox.replaceChildren(makeDetailCard(selected));
  drawMap(selected);
}

// Loads the photo links of one record once, then redraws.
const photosLoading = {};
async function loadPhotos(id) {
  if (photosById[id] !== undefined || photosLoading[id]) {
    return;
  }
  photosLoading[id] = true;
  try {
    const result = await api('/officer/reviews/' + id + '/photos');
    photosById[id] = result.data || [];
  } catch (error) {
    photosById[id] = null;
  }
  delete photosLoading[id];
  if (findObservation(pending, id) !== null) {
    drawQueue();
  }
}

// ---- Deciding ----

// Saves the officer's decision. On success: a toast, the row is removed, the next record
// is selected and the counts are updated. On failure the record stays, with the reason.
async function reviewObservation(id, decision, comments) {
  if (busy) {
    return;
  }
  busy = true;
  drawQueue();
  const ordered = sortByDate(pending, item => item.observed_at, sortOrder);
  const position = ordered.findIndex(item => item.id === id);
  try {
    await api('/officer/reviews/' + id + '/decision', {
      method: 'POST',
      body: JSON.stringify({ decision: decision, comments: comments }),
    });
  } catch (error) {
    // e.g. "This plant has no species yet, so the observation can't be approved."
    busy = false;
    showToast(error.message);
    drawQueue();
    return;
  }
  busy = false;
  showToast(decision === 'approved' ? 'Field record approved' : 'Field record sent back to the botanist');
  pending = pending.filter(item => item.id !== id);
  delete photosById[id];
  delete chosenPhoto[id];
  delete reasonDrafts[id];
  if (sendBackOpenFor === id) sendBackOpenFor = null;
  // The next record in the list (or the one before it, when this was the last).
  const remaining = ordered.filter(item => item.id !== id);
  const next = remaining[Math.min(position, remaining.length - 1)];
  selectedId = next ? next.id : null;
  drawQueue();
  // Keep the Field records and Review badges in step after every decision.
  refreshFieldRecordsCount().catch(error => {
    showToast('Field record count could not be loaded. ' + error.message);
  });
}

// Loads the waiting records from the backend.
async function loadQueue() {
  document.getElementById('queue-count').textContent = 'Loading field records...';
  try {
    const result = await api('/officer/reviews/pending');
    pending = result.data || [];
  } catch (error) {
    pending = [];
    document.getElementById('queue-area').hidden = true;
    document.getElementById('queue-empty').hidden = true;
    document.getElementById('queue-count').textContent = 'Could not load the field records: ' + error.message;
    return;
  }
  drawQueue();
  // Keep the Field records and Review badges in step after every load.
  refreshFieldRecordsCount().catch(error => {
    showToast('Field record count could not be loaded. ' + error.message);
  });
}

loadQueue().catch(showUnexpectedError);
