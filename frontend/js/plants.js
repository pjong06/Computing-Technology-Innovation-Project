// plants.js - the officer-only, paged plant catalogue.

drawMenu('plants.html');

const PAGE_SIZE = 20;
let currentPage = 1;
let searchTimer = null;
let plantCount = 0;
let totalPages = 0;

const byId = id => document.getElementById(id);

function formattedStatus(value) {
  const status = String(value || 'unknown');
  const label = {
    pending: 'Pending',
    approved: 'Approved',
    rejected: 'Needs changes'
  }[status.toLowerCase()] || status.replaceAll('_', ' ');
  const css = ['pending', 'approved', 'rejected'].includes(status.toLowerCase())
    ? status.toLowerCase()
    : '';
  return { label, css };
}

function displayDate(value) {
  if (!value) return 'None recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function makePlantRow(plant) {
  const link = document.createElement('a');
  link.className = 'card plant-row';
  link.href = 'plant.html?id=' + encodeURIComponent(plant.id);
  link.setAttribute('aria-label', 'View plant ' + (plant.tag_code || 'without a tag code'));

  const image = document.createElement('img');
  image.className = 'plant-thumb';
  image.alt = '';
  image.loading = 'lazy';
  image.src = plant.photo_thumbnail?.url || PICTURE_BLANK;
  image.onerror = function () {
    image.onerror = null;
    image.src = PICTURE_BLANK;
  };
  link.appendChild(image);

  const info = document.createElement('div');
  const heading = document.createElement('h2');
  heading.className = 'plant-title';
  heading.textContent = plant.species?.scientific_name || 'Species not recorded';
  info.appendChild(heading);

  const speciesName = document.createElement('div');
  speciesName.className = 'plant-sub';
  speciesName.textContent = plant.species?.common_name || 'No common name recorded';
  info.appendChild(speciesName);

  const meta = document.createElement('div');
  meta.className = 'plant-meta';
  meta.textContent = 'Tag: ' + (plant.tag_code || 'No tag') +
    ' · Location: ' + (plant.location_description || 'Not recorded');
  info.appendChild(meta);

  const registered = document.createElement('div');
  registered.className = 'plant-meta';
  registered.textContent = 'Registered by: ' + (plant.registered_by || 'Unknown') +
    ' · Last visit: ' + displayDate(plant.last_observation_at);
  info.appendChild(registered);
  link.appendChild(info);

  const status = formattedStatus(plant.plant_status);
  const badge = document.createElement('span');
  badge.className = 'plant-status ' + status.css;
  badge.textContent = status.label;
  link.appendChild(badge);
  return link;
}

function updatePager() {
  byId('plants-pager').hidden = totalPages < 2;
  byId('plants-page').textContent = `Page ${currentPage} of ${totalPages}`;
  byId('plants-previous').disabled = currentPage <= 1;
  byId('plants-next').disabled = currentPage >= totalPages;
}

async function loadPlants() {
  const loading = byId('plants-loading');
  const errorBox = byId('plants-error');
  const emptyBox = byId('plants-empty');
  const list = byId('plants-list');
  loading.hidden = false;
  errorBox.hidden = true;
  emptyBox.hidden = true;
  list.replaceChildren();
  byId('plants-pager').hidden = true;

  const params = new URLSearchParams({
    page: String(currentPage),
    page_size: String(PAGE_SIZE),
  });
  const search = byId('plant-search').value.trim();
  const species = byId('plant-species').value;
  const status = byId('plant-status-filter').value;
  const conservation = byId('conservation-filter').value;
  const registeredBy = byId('registered-by-filter').value;
  if (search) params.set('search', search);
  if (species) params.set('species_id', species);
  if (status) params.set('plant_status', status);
  if (conservation) params.set('conservation_status', conservation);
  if (registeredBy) params.set('registered_by', registeredBy);

  try {
    const result = await api('/officer/plants?' + params.toString());
    if (!result || !Array.isArray(result.data) || !result.pagination) {
      throw new Error('The plant catalogue response was invalid.');
    }
    plantCount = result.pagination.total;
    totalPages = result.pagination.total_pages;
    byId('plants-count').textContent =
      `Showing ${result.data.length} of ${plantCount} plants`;
    result.data.forEach(plant => list.appendChild(makePlantRow(plant)));
    emptyBox.hidden = result.data.length > 0;
    updatePager();
  } catch (error) {
    errorBox.textContent = 'Plants could not be loaded. ' + (error.message || 'Please try again.');
    errorBox.hidden = false;
    byId('plants-count').textContent = 'Plant catalogue unavailable';
    showUnexpectedError(error);
  } finally {
    loading.hidden = true;
  }
}

function replaceOptions(select, firstLabel, rows, valueOf, labelOf, selectedValue) {
  select.replaceChildren(new Option(firstLabel, ''));
  rows.forEach(row => select.add(new Option(labelOf(row), valueOf(row))));
  if (selectedValue && Array.from(select.options).some(option => option.value === selectedValue)) {
    select.value = selectedValue;
  }
}

async function loadFilterOptions() {
  const speciesSelect = byId('plant-species');
  const requestedSpecies = new URLSearchParams(location.search).get('species') || '';
  if (requestedSpecies) speciesSelect.value = requestedSpecies;

  try {
    const [facets, species] = await Promise.all([
      api('/officer/plants/facets'),
      fetchAllPages('/knowledge/species/manage'),
    ]);
    const allSpecies = (species || []).slice().sort((a, b) =>
      (a.scientific_name || '').localeCompare(b.scientific_name || '')
    );
    replaceOptions(
      speciesSelect,
      'All species',
      allSpecies,
      item => item.id,
      item => item.scientific_name || item.common_name || 'Unnamed species',
      requestedSpecies
    );
    replaceOptions(
      byId('plant-status-filter'),
      'All plant statuses',
      facets.data.plant_statuses || [],
      value => value,
      value => formattedStatus(value).label,
      ''
    );
    replaceOptions(
      byId('registered-by-filter'),
      'All registered by',
      facets.data.registered_by || [],
      item => item.id,
      item => item.name,
      ''
    );
  } catch (error) {
    showToast('Some plant filters could not be loaded. ' + (error.message || 'Please refresh.'));
  }
}

if (pageAllowed === false) {
  // guardPages is redirecting the user; do not request officer plant data.
} else {
  byId('plant-filters').addEventListener('submit', event => {
    event.preventDefault();
    currentPage = 1;
    void loadPlants();
  });
  ['plant-species', 'plant-status-filter', 'conservation-filter', 'registered-by-filter']
    .forEach(id => byId(id).addEventListener('change', () => {
      currentPage = 1;
      void loadPlants();
    }));
  byId('plant-search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      currentPage = 1;
      void loadPlants();
    }, 250);
  });
  byId('plants-previous').addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage -= 1;
      void loadPlants();
    }
  });
  byId('plants-next').addEventListener('click', () => {
    if (currentPage < totalPages) {
      currentPage += 1;
      void loadPlants();
    }
  });
  loadFilterOptions().then(() => loadPlants()).catch(showUnexpectedError);
}
