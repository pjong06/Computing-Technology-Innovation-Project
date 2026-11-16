// plant.js - officer-only plant details and observation history.

drawMenu('plant.html');

const byId = id => document.getElementById(id);

function displayDate(value) {
  if (!value) return 'None recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
}

function plantStatus(value) {
  const status = String(value || 'unknown');
  return {
    label: {
      pending: 'Pending',
      approved: 'Approved',
      rejected: 'Needs changes',
    }[status.toLowerCase()] || status.replaceAll('_', ' '),
    css: ['pending', 'approved', 'rejected'].includes(status.toLowerCase()) ? status.toLowerCase() : '',
  };
}

function cell(row, value, className) {
  const td = document.createElement('td');
  td.textContent = value === null || value === undefined || value === '' ? '—' : String(value);
  if (className) td.className = className;
  row.appendChild(td);
}

function formatHeight(heightCm) {
  return heightCm === null || heightCm === undefined
    ? '—'
    : `${Math.round(Number(heightCm)) / 100} m`;
}

function formatDiameter(diameterCm) {
  return diameterCm === null || diameterCm === undefined
    ? '—'
    : `${Math.round(Number(diameterCm) * 100) / 100} cm`;
}

function renderPhotos(photos, speciesPhoto) {
  const grid = byId('plant-photos');
  grid.replaceChildren();
  const speciesFallback = photos.length === 0 && speciesPhoto?.url ? speciesPhoto : null;
  byId('plant-no-photos').hidden = photos.length > 0 || Boolean(speciesFallback);
  byId('plant-photo-heading').textContent =
    speciesFallback ? 'Species reference photo' : 'Plant photos';
  photos.forEach(photo => {
    const image = document.createElement('img');
    image.src = photo.url || PICTURE_BLANK;
    image.alt = photo.photo_type ? photo.photo_type.replaceAll('_', ' ') : 'Plant photo';
    image.loading = 'lazy';
    image.onerror = function () {
      image.onerror = null;
      image.src = PICTURE_BLANK;
    };
    grid.appendChild(image);
  });

  if (speciesFallback) {
    const figure = document.createElement('figure');
    figure.className = 'species-photo-fallback';
    const image = document.createElement('img');
    image.src = speciesFallback.url;
    image.alt = 'Species reference photo';
    image.loading = 'lazy';
    const caption = document.createElement('figcaption');
    caption.textContent = 'Species photo';
    const credit = makeSpeciesPhotoCredit(speciesFallback, false);
    image.onerror = function () {
      image.onerror = null;
      image.src = PICTURE_BLANK;
      figure.hidden = true;
      byId('plant-no-photos').hidden = false;
    };
    figure.appendChild(image);
    figure.appendChild(caption);
    if (credit) figure.appendChild(credit);
    grid.appendChild(figure);
  }
}

function renderObservations(observations) {
  const body = byId('observations-body');
  body.replaceChildren();
  byId('observations-count').textContent =
    `${observations.length} observation${observations.length === 1 ? '' : 's'}`;
  byId('observations-empty').hidden = observations.length > 0;
  observations.forEach(observation => {
    const row = document.createElement('tr');
    cell(row, displayDate(observation.observed_at));
    cell(row, observation.observer_name);
    cell(row, observation.health_status);
    cell(row, observation.life_stage);
    cell(row, formatHeight(observation.height_cm));
    cell(row, formatDiameter(observation.diameter_cm));
    const review = plantStatus(observation.review_status);
    cell(row, review.label, review.css === 'rejected' ? 'review-rejected' : '');
    cell(row, observation.reviewer_comment);
    body.appendChild(row);
  });
}

function renderMap(plant) {
  const mapElement = byId('plant-map');
  if (!Number.isFinite(Number(plant.latitude)) || !Number.isFinite(Number(plant.longitude)) ||
      plant.latitude === null || plant.longitude === null) {
    mapElement.hidden = true;
    byId('plant-map-message').textContent = 'A GPS location has not been recorded for this plant.';
    return;
  }
  if (typeof L === 'undefined') {
    mapElement.hidden = true;
    byId('plant-map-message').textContent = 'The map could not load. Check your internet connection.';
    return;
  }

  const point = [Number(plant.latitude), Number(plant.longitude)];
  const map = L.map(mapElement).setView(point, 16);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri',
  }).addTo(map);
  L.marker(point).addTo(map);
  byId('plant-map-message').textContent = 'Exact plant location (officer only).';
}

function renderPlant(plant) {
  byId('plant-detail').hidden = false;
  byId('plant-tag').textContent = plant.tag_code || 'No tag code';
  byId('plant-title').textContent = plant.species?.common_name || plant.species?.scientific_name || 'Plant';
  byId('plant-species').textContent = plant.species?.scientific_name || 'Species not recorded';
  byId('plant-source').textContent = plant.data_source === 'inaturalist'
    ? `Source: iNaturalist observation · Observer: ${plant.source_observer || 'Unknown'} · Licence: ${plant.source_licence || 'Unknown'}`
    : 'Source: Field record (registered in the app)';
  const status = plantStatus(plant.plant_status);
  const statusElement = byId('plant-status');
  statusElement.textContent = status.label;
  statusElement.className = 'detail-value plant-status ' + status.css;
  const imported = plant.data_source === 'inaturalist';
  byId('plant-registered-label').textContent = imported ? 'Imported source' : 'Registered by';
  byId('plant-registered-by').textContent = imported
    ? `Imported from iNaturalist · Observer: ${plant.source_observer || 'Unknown'}`
    : plant.registered_by || 'Unknown';
  byId('plant-registered-at').textContent = displayDate(plant.registered_at);
  byId('plant-last-observation').textContent = displayDate(plant.last_observation_at);
  byId('plant-location').textContent = plant.location_description || 'Not recorded';
  byId('plant-conservation').textContent = plant.species?.conservation_status || 'Not assessed';
  byId('plant-coordinates').textContent = plant.latitude === null || plant.longitude === null
    ? 'Not recorded'
    : `${plant.latitude}, ${plant.longitude}`;
  byId('plant-observation-count').textContent = String(plant.observation_count);
  renderPhotos(plant.photos || [], plant.species_photo);
  renderObservations(plant.observations || []);
  renderMap(plant);
}

async function loadPlant() {
  const id = new URLSearchParams(location.search).get('id') || '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    byId('plant-loading').hidden = true;
    byId('plant-error').textContent = 'A valid plant ID is required.';
    byId('plant-error').hidden = false;
    return;
  }
  try {
    const result = await api('/officer/plants/' + encodeURIComponent(id));
    if (!result?.data || !Array.isArray(result.data.photos) || !Array.isArray(result.data.observations)) {
      throw new Error('The plant details response was invalid.');
    }
    renderPlant(result.data);
  } catch (error) {
    byId('plant-error').textContent =
      'Plant details could not be loaded. ' + (error.message || 'Please try again.');
    byId('plant-error').hidden = false;
    showUnexpectedError(error);
  } finally {
    byId('plant-loading').hidden = true;
  }
}

if (pageAllowed === false) {
  // guardPages is redirecting the user; do not request officer plant data.
} else {
  loadPlant().catch(showUnexpectedError);
}
