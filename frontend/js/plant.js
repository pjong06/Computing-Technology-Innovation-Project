// plant.js - officer-only plant detail: breadcrumb and actions (Print QR tag, Visitor page,
// "⋯" with Show on park map), a banner when observations are waiting for review, the header
// card (photos with caption, chips, name, species line, Registered by / Registered / Last
// observation / Location note), Latest measurements (from the last approved observation,
// with the change since the first one), Location (officers only: map with nearby sensor
// stations, coordinates and accuracy), Field notes and the Observations timeline.
// Rows and sections with nothing in them are left out instead of showing "—".

drawMenu('plant.html');

const byId = id => document.getElementById(id);
const REAL_TAG = /^NIAH-PLT-\d{5}$/;
const STRIP_PHOTOS = 4;          // thumbnails under the main photo; "View all N" shows the rest
const NEARBY_STATION_METRES = 2000;

// ---- Top bar: breadcrumb, Print QR tag, Visitor page, "⋯" menu ----

function parkMapLink(plant) {
  return 'map.html?plant=' + encodeURIComponent(plant.id);
}

function renderTopBar(plant) {
  const shownTag = displayTag(plant.tag_code, 'No tag yet');
  byId('plant-crumb').textContent = shownTag;
  byId('plant-crumb').title = shownTag;
  const hasTag = REAL_TAG.test(String(plant.tag_code ?? ''));

  const print = byId('print-qr');
  print.disabled = !hasTag;
  print.title = hasTag ? 'Download this plant\'s QR tag (PDF)' : 'This plant has no NIAH-PLT tag yet.';
  print.onclick = () => void printQrTag(plant);

  const visitor = byId('visitor-link');
  if (hasTag) {
    visitor.href = '/p/' + encodeURIComponent(plant.tag_code);
    visitor.removeAttribute('aria-disabled');
    visitor.title = 'The page visitors see when they scan the tag (opens in a new tab)';
  } else {
    visitor.removeAttribute('href');
    visitor.setAttribute('aria-disabled', 'true');
    visitor.title = 'This plant has no NIAH-PLT tag yet.';
  }

  byId('menu-map').href = parkMapLink(plant);
  makePopover(byId('plant-more'), byId('plant-menu'));
  byId('plant-actions').hidden = false;
}

// The officer QR tag PDF for this one plant (the same endpoint as the Plants list).
async function printQrTag(plant) {
  try {
    const file = await apiFile('/officer/plants/qr-tags', { method: 'POST', body: JSON.stringify({ plant_ids: [plant.id] }) });
    downloadBlob(file.blob, file.name);
    showToast('QR tag for ' + plant.tag_code + ' downloaded.');
  } catch (error) {
    showToast('The QR tag could not be printed: ' + error.message);
  }
}

// ---- "N new observations from <botanist> waiting for review" ----

function renderPendingBanner(observations) {
  const waiting = sortByDate(observations.filter(item => item.review_status === 'pending'), item => item.observed_at, SORT_NEWEST);
  const banner = byId('pending-banner');
  banner.hidden = waiting.length === 0;
  if (waiting.length === 0) return;
  const names = [...new Set(waiting.map(item => item.observer_name || 'a botanist'))];
  const from = names.length === 1 ? names[0] : names.length + ' botanists';
  byId('pending-text').textContent = waiting.length + ' new observation' + (waiting.length === 1 ? '' : 's') +
    ' from ' + from + ' waiting for review';
  byId('pending-link').href = 'queue.html?observation=' + encodeURIComponent(waiting[0].id);
}

// ---- Photos: main photo with "<date> · <botanist>", full size, thumbnails, "View all N" ----

function photoCaption(photo, plant) {
  return [formatDay(photo.taken_at || plant.registered_at, ''), photo.added_by_name || plant.registered_by || '']
    .filter(Boolean).join(' · ');
}

function photoImage(photo, className) {
  const image = document.createElement('img');
  if (className) image.className = className;
  image.alt = photo.photo_type ? readableValue(photo.photo_type) : 'Plant photo';
  image.src = photo.url || PICTURE_BLANK;
  image.onerror = function () {
    image.onerror = null;
    image.src = PICTURE_BLANK;
  };
  return image;
}

function openPhotoDialog(title, content) {
  byId('photo-dialog-title').textContent = title;
  byId('photo-dialog-body').replaceChildren(...content);
  byId('photo-dialog').showModal();
}

function renderGallery(photos, plant) {
  const image = byId('gallery-image');
  const strip = byId('gallery-strip');
  const caption = byId('gallery-caption');
  const expand = byId('gallery-expand');
  const all = byId('gallery-all');
  strip.replaceChildren();
  image.onerror = function () {
    image.onerror = null;
    image.src = PICTURE_BLANK;
  };
  if (photos.length === 0) {
    image.src = PICTURE_BLANK;
    image.alt = 'No photos of this plant yet';
    caption.hidden = true;
    expand.hidden = true;
    all.hidden = true;
    return;
  }
  // The main photo first, then the others as they were added.
  const ordered = [...photos].sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)));
  let current = 0;
  const show = function (index) {
    current = index;
    const photo = ordered[index];
    image.onerror = function () {
      image.onerror = null;
      image.src = PICTURE_BLANK;
    };
    image.src = photo.url || PICTURE_BLANK;
    image.alt = photo.photo_type ? readableValue(photo.photo_type) : 'Plant photo';
    const text = photoCaption(photo, plant);
    caption.textContent = text;
    caption.title = text;
    caption.hidden = text === '';
    Array.from(strip.children).forEach((button, i) => button.setAttribute('aria-current', String(i === index)));
  };
  if (ordered.length > 1) {
    ordered.slice(0, STRIP_PHOTOS).forEach(function (photo, index) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', 'Show photo ' + (index + 1) + ' of ' + ordered.length);
      const thumb = photoImage(photo);
      thumb.alt = '';
      thumb.loading = 'lazy';
      button.appendChild(thumb);
      button.onclick = function () { show(index); };
      strip.appendChild(button);
    });
  }
  expand.hidden = false;
  expand.onclick = function () {
    const photo = ordered[current];
    const text = labelSpan('photo-dialog-caption');
    text.textContent = photoCaption(photo, plant);
    openPhotoDialog('Photo ' + (current + 1) + ' of ' + ordered.length, [photoImage(photo, 'photo-full'), text]);
  };
  all.hidden = ordered.length < 2;
  all.textContent = 'View all ' + ordered.length;
  all.onclick = function () {
    const grid = document.createElement('div');
    grid.className = 'photo-grid';
    ordered.forEach(function (photo, index) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', 'Show photo ' + (index + 1) + ' of ' + ordered.length);
      const thumb = photoImage(photo);
      thumb.loading = 'lazy';
      button.appendChild(thumb);
      button.onclick = function () {
        show(Math.min(index, ordered.length - 1));
        byId('photo-dialog').close();
      };
      grid.appendChild(button);
    });
    openPhotoDialog('All ' + ordered.length + ' photos', [grid]);
  };
  show(0);
}

// ---- Header: chips, name, species line, facts ----

function conservationChip(code) {
  const chip = labelSpan('status-chip');
  const dot = labelSpan('status-dot ' + (STATUS_CLASS[code] || 'unknown'));
  dot.setAttribute('aria-hidden', 'true');
  chip.append(dot, clippedText(statusLabel(code)));
  if (THREATENED_CODES.includes(code)) chip.appendChild(lockIcon());
  return chip;
}

function renderTitle(plant) {
  const species = plant.species || {};
  byId('plant-title').textContent = species.scientific_name || 'Species not recorded';
  document.title = (species.scientific_name || 'Plant') + ' - Niah Biotrack';

  // "common name · family · Open species"
  const sub = byId('plant-species');
  sub.replaceChildren();
  const words = [species.common_name, species.family].filter(Boolean);
  if (words.length) sub.append(words.join(' · '));
  if (species.id) {
    if (words.length) sub.append(' · ');
    const open = document.createElement('a');
    open.href = '#';
    open.textContent = 'Open species';
    open.onclick = function (event) {
      event.preventDefault();
      openSpeciesEditor(species.id);
    };
    sub.appendChild(open);
  }
  sub.hidden = sub.childNodes.length === 0;

  const chips = byId('plant-chips');
  chips.replaceChildren();
  const tag = displayTag(plant.tag_code, '');
  chips.appendChild(tag && tag !== NO_PHYSICAL_TAG ? labelSpan('status-badge', tag) : labelSpan('chip-muted', 'No tag yet'));
  const status = reviewStatusDisplay(plant.plant_status);
  chips.appendChild(labelSpan(('status-badge ' + status.css).trim(), status.label));
  chips.appendChild(conservationChip(species.conservation_status));

  const facts = byId('plant-facts');
  facts.replaceChildren();
  for (const [label, value] of [
    ['Registered by', plant.registered_by || 'Not recorded'],
    ['Registered', formatDay(plant.registered_at)],
    ['Last observation', formatDay(plant.last_observation_at, 'None yet')],
    ['Location note', plant.location_description || 'Not recorded'],
  ]) {
    const item = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = value;
    item.append(term, detail);
    facts.appendChild(item);
  }
}

// ---- Latest measurements: the last approved observation, and the change since the first ----

function formatHeight(heightCm) {
  return heightCm === null || heightCm === undefined ? '' : String(Math.round(Number(heightCm)) / 100);
}

function formatDiameter(diameterCm) {
  return diameterCm === null || diameterCm === undefined ? '' : String(Math.round(Number(diameterCm) * 100) / 100);
}

const hasValue = value => value !== null && value !== undefined && value !== '';

// "Aug", or "Aug 2025" when the first observation was in another year.
function sinceText(firstAt, latestAt) {
  const first = new Date(firstAt);
  if (Number.isNaN(first.getTime())) return '';
  const sameYear = first.getFullYear() === new Date(latestAt).getFullYear();
  return MONTHS[first.getMonth()] + (sameYear ? '' : ' ' + first.getFullYear());
}

// "+0.2 m since Aug" / "No change since Aug" / '' when there is nothing to compare.
function changeText(latest, first, field, unit, scale, decimals) {
  if (!first || first === latest || !hasValue(latest[field]) || !hasValue(first[field])) return '';
  const since = sinceText(first.observed_at, latest.observed_at);
  if (!since) return '';
  const change = Math.round((Number(latest[field]) - Number(first[field])) / scale * 10 ** decimals) / 10 ** decimals;
  if (!Number.isFinite(change)) return '';
  if (change === 0) return 'No change since ' + since;
  return (change > 0 ? '+' : '−') + Math.abs(change) + ' ' + unit + ' since ' + since;
}

function renderMeasurements(observations) {
  const approved = sortByDate(observations.filter(item => item.review_status === 'approved'), item => item.observed_at, SORT_NEWEST);
  const latest = approved[0];
  const first = approved[approved.length - 1];
  const box = byId('measurements');
  box.replaceChildren();
  if (!latest) {
    byId('measurements-card').hidden = true;
    return;
  }
  const tiles = [
    ['Height (m)', formatHeight(latest.height_cm), changeText(latest, first, 'height_cm', 'm', 100, 2)],
    ['Diameter (cm)', formatDiameter(latest.diameter_cm), changeText(latest, first, 'diameter_cm', 'cm', 1, 1)],
    ['Health', readableValue(latest.health_status), ''],
    ['Life stage', readableValue(latest.life_stage), ''],
  ].filter(tile => tile[1] !== '');
  for (const [label, value, change] of tiles) {
    const tile = labelSpan('tile');
    tile.append(labelSpan('tile-label', label), labelSpan('tile-value', value));
    if (change) tile.appendChild(labelSpan('tile-change', change));
    box.appendChild(tile);
  }
  byId('measurements-date').textContent = 'Observed ' + formatDay(latest.observed_at);
  byId('measurements-card').hidden = tiles.length === 0;
}

// ---- Location (officers only): map with the plant and nearby sensor stations ----

function infoRows(container, rows) {
  container.replaceChildren();
  for (const [label, value] of rows) {
    if (!value) continue;
    const row = labelSpan('info-row');
    row.append(labelSpan('info-label', label), labelSpan('info-value', value));
    container.appendChild(row);
  }
  return container.children.length;
}

function hasPoint(plant) {
  return plant.latitude !== null && plant.longitude !== null &&
    Number.isFinite(Number(plant.latitude)) && Number.isFinite(Number(plant.longitude));
}

// Distance in metres between two [lat, lng] points.
function metresBetween(a, b) {
  const toRad = degrees => degrees * Math.PI / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function distanceText(metres) {
  return metres < 1000 ? Math.round(metres) + ' m' : (Math.round(metres / 100) / 10) + ' km';
}

function locationRows(plant, stationsText) {
  const located = hasPoint(plant);
  const accuracy = Number(plant.gps_accuracy_m);
  return [
    ['Coordinates', located ? displayCoordinates(plant.latitude, plant.longitude) : 'Not recorded'],
    ['GPS accuracy', located && plant.gps_accuracy_m !== null && Number.isFinite(accuracy) ? '± ' + Math.round(accuracy) + ' m' : ''],
    ['Sensor stations', stationsText],
  ];
}

async function addNearbyStations(map, plant, point) {
  try {
    const result = await api('/officer/map/stations');
    const nearby = (result?.data || [])
      .map(station => ({ station, metres: metresBetween(point, [station.latitude, station.longitude]) }))
      .filter(item => item.metres <= NEARBY_STATION_METRES)
      .sort((a, b) => a.metres - b.metres);
    for (const { station, metres } of nearby) {
      L.circleMarker([station.latitude, station.longitude], {
        radius: 7, color: '#ffffff', weight: 2, fillColor: '#1f4e8c', fillOpacity: 0.9,
      }).bindTooltip((station.station_code || 'Sensor station') + ' · ' + distanceText(metres)).addTo(map);
    }
    const text = nearby.length === 0
      ? 'None within ' + distanceText(NEARBY_STATION_METRES)
      : nearby.slice(0, 3).map(item => (item.station.station_code || 'Station') + ' (' + distanceText(item.metres) + ')').join(', ') +
        (nearby.length > 3 ? ' and ' + (nearby.length - 3) + ' more' : '');
    infoRows(byId('location-rows'), locationRows(plant, text));
    if (nearby.length) {
      map.fitBounds(L.latLngBounds([point, ...nearby.map(item => [item.station.latitude, item.station.longitude])]), { padding: [24, 24], maxZoom: 17 });
    }
  } catch (error) {
    // The plant's own location still shows; only the stations are missing.
    console.error('Sensor stations could not be loaded:', error);
  }
}

function renderLocation(plant) {
  const located = hasPoint(plant);
  infoRows(byId('location-rows'), locationRows(plant, ''));
  byId('location-map-link').href = parkMapLink(plant);
  byId('location-map-link').hidden = !located;
  const mapElement = byId('plant-map');
  mapElement.hidden = !located || typeof L === 'undefined';
  if (mapElement.hidden) return;
  const point = [Number(plant.latitude), Number(plant.longitude)];
  const map = L.map(mapElement).setView(point, 16);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri',
  }).addTo(map);
  L.marker(point).bindTooltip(displayTag(plant.tag_code, 'This plant')).addTo(map);
  void addNearbyStations(map, plant, point);
}

// ---- Field notes: morphology and notes (the card is hidden when both are empty) ----

function renderFieldNotes(plant) {
  const box = byId('field-notes');
  box.replaceChildren();
  for (const [label, text] of [['Morphology', plant.morphology], ['Notes', plant.notes]]) {
    if (!text) continue;
    const block = document.createElement('div');
    block.className = 'note-block';
    const heading = labelSpan('info-label', label);
    const body = document.createElement('p');
    body.textContent = text;
    block.append(heading, body);
    box.appendChild(block);
  }
  byId('field-notes-card').hidden = box.children.length === 0;
}

// ---- Observations timeline: newest first by default; the select switches to oldest first ----

let historySort = SORT_NEWEST;
let historyRows = [];

function observationChips(observation) {
  return [
    formatHeight(observation.height_cm) && 'Height ' + formatHeight(observation.height_cm) + ' m',
    formatDiameter(observation.diameter_cm) && 'Diameter ' + formatDiameter(observation.diameter_cm) + ' cm',
    readableValue(observation.health_status) && 'Health: ' + readableValue(observation.health_status),
    readableValue(observation.life_stage) && 'Life stage: ' + readableValue(observation.life_stage),
  ].filter(Boolean);
}

function renderObservations(observations) {
  historyRows = observations;
  addListSortSelect('observations-count', 'observations-sort', function (order) {
    historySort = order;
    renderObservations(historyRows);
  });
  const list = byId('observations-list');
  list.replaceChildren();
  byId('observations-total').textContent = observations.length ? String(observations.length) : '';
  byId('observations-count').textContent = observations.length === 0
    ? ''
    : `${observations.length} observation${observations.length === 1 ? '' : 's'}`;
  byId('observations-empty').hidden = observations.length > 0;
  sortByDate(observations, observation => observation.observed_at, historySort).forEach(observation => {
    const item = document.createElement('div');
    item.className = 'observation-item';
    const top = labelSpan('observation-top');
    const review = reviewStatusDisplay(observation.review_status);
    top.append(
      labelSpan('observation-date', formatWhen(observation.observed_at, 'Date not recorded') + ' · ' +
        (observation.observer_name || 'Unknown botanist')),
      labelSpan(('status-badge ' + review.css).trim(), review.label));
    item.appendChild(top);
    if (observation.notes) {
      const note = document.createElement('p');
      note.className = 'observation-note';
      note.textContent = observation.notes;
      item.appendChild(note);
    }
    const chips = observationChips(observation);
    if (chips.length) {
      const row = labelSpan('observation-chips');
      for (const text of chips) row.appendChild(labelSpan('chip-muted', text));
      item.appendChild(row);
    }
    // The officer's reason when the observation was sent back.
    if (observation.review_status === 'rejected' && observation.reviewer_comment) {
      const reason = document.createElement('p');
      reason.className = 'observation-reason';
      reason.textContent = 'Reason: ' + observation.reviewer_comment;
      item.appendChild(reason);
    }
    list.appendChild(item);
  });
}

function renderPlant(plant) {
  byId('plant-detail').hidden = false;
  renderTopBar(plant);
  renderPendingBanner(plant.observations || []);
  renderGallery(plant.photos || [], plant);
  renderTitle(plant);
  renderMeasurements(plant.observations || []);
  renderLocation(plant);
  renderFieldNotes(plant);
  renderObservations(plant.observations || []);
}

async function loadPlant() {
  const id = new URLSearchParams(location.search).get('id') || '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    byId('plant-loading').hidden = true;
    byId('plant-error').textContent = 'This plant link is not valid. Open the plant from the Plants list.';
    byId('plant-error').hidden = false;
    return;
  }
  try {
    const result = await api('/officer/plants/' + encodeURIComponent(id));
    if (!result?.data || !Array.isArray(result.data.photos) || !Array.isArray(result.data.observations)) {
      throw new Error('The data could not be read. Please reload the page.');
    }
    renderPlant(result.data);
  } catch (error) {
    byId('plant-error').textContent =
      'Plant details could not be loaded. ' + (error.message || 'Please try again.');
    byId('plant-error').hidden = false;
    console.error('Plant details failed to load:', error);
  } finally {
    byId('plant-loading').hidden = true;
  }
}

if (pageAllowed === false) {
  // guardPages is redirecting the user; do not request officer plant data.
} else {
  byId('photo-dialog-close').addEventListener('click', () => byId('photo-dialog').close());
  loadPlant().catch(showUnexpectedError);
}
