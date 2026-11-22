// plant.js - officer-only plant detail, laid out like the app's plant detail: photo gallery,
// italic name, "common name · family", chips, then Measurements (from the latest approved
// observation), Location, Field notes and Observations (newest first). Sections and rows with
// nothing in them are left out instead of showing "—".

drawMenu('plant.html');

const byId = id => document.getElementById(id);

// ---- Photo gallery (the plant's own photos; never a credit or source) ----

function renderGallery(photos) {
  const image = byId('gallery-image');
  const strip = byId('gallery-strip');
  const count = byId('gallery-count');
  strip.replaceChildren();
  image.onerror = function () {
    image.onerror = null;
    image.src = PICTURE_BLANK;
  };
  if (photos.length === 0) {
    image.src = PICTURE_BLANK;
    image.alt = 'No photos of this plant yet';
    count.hidden = true;
    return;
  }
  const show = function (index) {
    const photo = photos[index];
    image.onerror = function () {
      image.onerror = null;
      image.src = PICTURE_BLANK;
    };
    image.src = photo.url || PICTURE_BLANK;
    image.alt = photo.photo_type ? readableValue(photo.photo_type) : 'Plant photo';
    count.textContent = (index + 1) + ' of ' + photos.length;
    count.hidden = photos.length < 2;
    Array.from(strip.children).forEach((button, i) => button.setAttribute('aria-current', String(i === index)));
  };
  if (photos.length > 1) {
    photos.forEach(function (photo, index) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', 'Show photo ' + (index + 1) + ' of ' + photos.length);
      const thumb = document.createElement('img');
      thumb.src = photo.url || PICTURE_BLANK;
      thumb.alt = '';
      thumb.loading = 'lazy';
      thumb.onerror = function () {
        thumb.onerror = null;
        thumb.src = PICTURE_BLANK;
      };
      button.appendChild(thumb);
      button.onclick = function () { show(index); };
      strip.appendChild(button);
    });
  }
  show(0);
}

// ---- Title block ----

function renderTitle(plant) {
  const species = plant.species || {};
  byId('plant-title').textContent = species.scientific_name || 'Species not recorded';
  document.title = (species.scientific_name || 'Plant') + ' - Niah Biotrack';
  const sub = [species.common_name, species.family].filter(Boolean).join(' · ');
  byId('plant-species').textContent = sub;
  byId('plant-species').hidden = sub === '';

  const chips = byId('plant-chips');
  chips.replaceChildren();
  const status = reviewStatusDisplay(plant.plant_status);
  chips.appendChild(labelSpan(('status-badge ' + status.css).trim(), status.label));
  const tag = displayTag(plant.tag_code, '');
  chips.appendChild(tag && tag !== NO_PHYSICAL_TAG ? labelSpan('status-badge', tag) : labelSpan('chip-muted', 'No tag yet'));
}

// ---- Measurements: each value from the newest approved observation that has it ----

function formatHeight(heightCm) {
  return heightCm === null || heightCm === undefined ? '' : String(Math.round(Number(heightCm)) / 100);
}

function formatDiameter(diameterCm) {
  return diameterCm === null || diameterCm === undefined ? '' : String(Math.round(Number(diameterCm) * 100) / 100);
}

function latestApproved(observations, field) {
  const approved = sortByDate(observations.filter(item => item.review_status === 'approved'), item => item.observed_at, SORT_NEWEST);
  const found = approved.find(item => item[field] !== null && item[field] !== undefined && item[field] !== '');
  return found ? found[field] : null;
}

function renderMeasurements(observations) {
  const tiles = [
    ['Height (m)', formatHeight(latestApproved(observations, 'height_cm'))],
    ['Diameter (cm)', formatDiameter(latestApproved(observations, 'diameter_cm'))],
    ['Health', readableValue(latestApproved(observations, 'health_status'))],
    ['Life stage', readableValue(latestApproved(observations, 'life_stage'))],
  ].filter(tile => tile[1] !== '');
  const box = byId('measurements');
  box.replaceChildren();
  for (const [label, value] of tiles) {
    const tile = labelSpan('tile');
    tile.append(labelSpan('tile-label', label), labelSpan('tile-value', value));
    box.appendChild(tile);
  }
  byId('measurements-card').hidden = tiles.length === 0;
}

// ---- Location: map pin, location note, coordinates (rows with nothing are left out) ----

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

function renderLocation(plant) {
  const located = hasPoint(plant);
  const rows = infoRows(byId('location-rows'), [
    ['Location note', plant.location_description],
    ['Coordinates', located ? displayCoordinates(plant.latitude, plant.longitude) : ''],
  ]);
  const mapElement = byId('plant-map');
  mapElement.hidden = !located || typeof L === 'undefined';
  byId('location-card').hidden = rows === 0 && !located;
  if (mapElement.hidden) return;
  const point = [Number(plant.latitude), Number(plant.longitude)];
  const map = L.map(mapElement).setView(point, 16);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri',
  }).addTo(map);
  L.marker(point).addTo(map);
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

// ---- Observations: newest first by default; the select switches to oldest first ----

let historySort = SORT_NEWEST;
let historyRows = [];

function observationMeasurements(observation) {
  return [
    formatHeight(observation.height_cm) && 'Height ' + formatHeight(observation.height_cm) + ' m',
    formatDiameter(observation.diameter_cm) && 'Diameter ' + formatDiameter(observation.diameter_cm) + ' cm',
    readableValue(observation.health_status) && 'Health: ' + readableValue(observation.health_status),
    readableValue(observation.life_stage) && 'Life stage: ' + readableValue(observation.life_stage),
  ].filter(Boolean).join(' · ');
}

function renderObservations(observations) {
  historyRows = observations;
  addListSortSelect('observations-count', 'observations-sort', function (order) {
    historySort = order;
    renderObservations(historyRows);
  });
  const list = byId('observations-list');
  list.replaceChildren();
  byId('observations-count').textContent = observations.length === 0
    ? ''
    : `${observations.length} observation${observations.length === 1 ? '' : 's'}`;
  byId('observations-empty').hidden = observations.length > 0;
  sortByDate(observations, observation => observation.observed_at, historySort).forEach(observation => {
    const item = document.createElement('div');
    item.className = 'observation-item';
    const top = labelSpan('observation-top');
    const review = reviewStatusDisplay(observation.review_status);
    top.append(labelSpan('observation-date', formatWhen(observation.observed_at, 'Date not recorded')),
      labelSpan(('status-badge ' + review.css).trim(), review.label));
    item.appendChild(top);
    item.appendChild(labelSpan('observation-by', 'Recorded by ' + (observation.observer_name || 'an unknown staff member')));
    const measured = observationMeasurements(observation);
    if (measured) item.appendChild(labelSpan('observation-by', measured));
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
  renderGallery(plant.photos || []);
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
  loadPlant().catch(showUnexpectedError);
}
