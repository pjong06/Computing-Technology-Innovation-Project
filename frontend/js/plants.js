// plants.js - the officer-only plant list as a data table: tabs by review status, search,
// filters, sortable columns, 10 per page, and bulk actions (print QR tags, export). The
// server pages and sorts (GET /api/officer/plants); the table helpers are shared (shared.js).

drawMenu('plants.html');

const byId = id => document.getElementById(id);

const plantSelection = new Set();      // selected plant ids (kept across pages)
const seenPlants = new Map();          // id -> plant row, for exporting the selection
const plantView = {
  tab: '',
  search: '',
  species: new URLSearchParams(location.search).get('species') || '',
  conservation: '',
  registeredBy: '',
  sort: null,                          // null = newest registered first
  page: 1,
  total: 0,
  rows: [],
  counts: unknownTabCounts(),
  request: 0,
};

// Tab counts before they are loaded.
function unknownTabCounts() {
  return [null, null, null, null];
}

// The tabs (review status of the plant).
const PLANT_TABS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Waiting for review' },
  { value: 'rejected', label: 'Needs changes' },
  { value: 'approved', label: 'Approved' },
];

// Column -> the server's sort key (only these columns can be sorted on the server).
const SERVER_SORT = { tag: 'tag', location: 'location', status: 'status' };

const PLANT_COLUMNS = [
  {
    key: 'plant', label: 'Plant', className: 'col-plant',
    render: (td, plant) => {
      const cell = labelSpan('plant-cell');
      const image = document.createElement('img');
      image.className = 'row-thumb';
      image.alt = '';
      image.loading = 'lazy';
      image.src = plant.photo_thumbnail?.url || PICTURE_BLANK;
      image.onerror = function () {
        image.onerror = null;
        image.src = PICTURE_BLANK;
      };
      const names = document.createElement('div');
      speciesNameCell(names, plant.species?.scientific_name, plant.species?.rank, plant.species?.common_name);
      cell.append(image, names);
      td.appendChild(cell);
    },
  },
  { key: 'tag', label: 'Tag', className: 'col-tag', sortable: true, render: (td, plant) => tagCell(td, plant.tag_code) },
  {
    key: 'location', label: 'Location', className: 'col-location', sortable: true,
    render: (td, plant) => {
      const line = labelSpan('cell-line');
      line.appendChild(plant.location_description
        ? clippedText(plant.location_description)
        : labelSpan('muted-text', 'Not recorded'));
      if (THREATENED_CODES.includes(plant.species?.conservation_status)) line.appendChild(lockIcon());
      td.appendChild(line);
    },
  },
  { key: 'by', label: 'Registered by', className: 'col-by', render: (td, plant) => td.appendChild(clippedText(plant.registered_by || 'Not recorded')) },
  { key: 'last', label: 'Last observation', className: 'col-last', render: (td, plant) => { td.textContent = formatDay(plant.last_observation_at, 'None yet'); } },
  {
    key: 'status', label: 'Status', className: 'col-status', sortable: true,
    render: (td, plant) => {
      const status = reviewStatusDisplay(plant.plant_status);
      const badge = labelSpan(('status-badge ' + status.css).trim(), status.label);
      badge.title = status.label;
      td.appendChild(badge);
    },
  },
  {
    key: 'view', label: '', className: 'col-view',
    render: (td, plant) => {
      const link = document.createElement('a');
      link.className = 'table-link';
      link.href = 'plant.html?id=' + encodeURIComponent(plant.id);
      link.textContent = 'View';
      link.setAttribute('aria-label', 'View plant ' + displayTag(plant.tag_code, 'without a tag'));
      td.appendChild(link);
    },
  },
];

// The request for the current tab, search, filters and sort. status overrides the tab
// (the tab counts ask for each status with the same filters).
function plantQuery(page, pageSize, status) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  const tabStatus = status === undefined ? plantView.tab : status;
  if (plantView.search) params.set('search', plantView.search);
  if (plantView.species) params.set('species_id', plantView.species);
  if (tabStatus) params.set('plant_status', tabStatus);
  if (plantView.conservation) params.set('conservation_status', plantView.conservation);
  if (plantView.registeredBy) params.set('registered_by', plantView.registeredBy);
  if (plantView.sort) {
    params.set('sort', SERVER_SORT[plantView.sort.key]);
    params.set('dir', plantView.sort.dir);
  }
  return '/officer/plants?' + params.toString();
}

function drawPlantTable() {
  drawDataTable(byId('plants-table'), {
    columns: PLANT_COLUMNS,
    rows: plantView.rows,
    keyOf: plant => plant.id,
    labelOf: plant => displayTag(plant.tag_code, plant.species?.scientific_name || 'plant'),
    selection: plantSelection,
    sort: plantView.sort,
    onSort: function (key) {
      plantView.sort = nextSort(plantView.sort, key);
      plantView.page = 1;
      loadPlants(false).catch(showUnexpectedError);
    },
    onSelect: drawPlantTable,
    empty: 'No plants match. Try changing the search, tab or filters.',
  });
  drawPager(byId('plants-pager'), plantView.page, plantView.total, function (page) {
    plantView.page = page;
    loadPlants(false).catch(showUnexpectedError);
  });
  drawBulkBar(byId('plants-bulk'), plantSelection.size, [
    { label: 'Print QR tags', onClick: () => printSelectedTags().catch(showUnexpectedError) },
    { label: 'Export selected', onClick: exportSelectedPlants },
  ], function () {
    plantSelection.clear();
    drawPlantTable();
  });
}

function drawPlantTabs() {
  drawTableTabs(byId('plant-tabs'),
    PLANT_TABS.map((tab, index) => ({ value: tab.value, label: tab.label, count: plantView.counts[index] })),
    plantView.tab,
    function (value) {
      plantView.tab = value;
      plantView.page = 1;
      drawPlantTabs();
      loadPlants(false).catch(showUnexpectedError);
    });
}

// Counts for the tabs, with the current search and filters (one small request per tab).
async function loadTabCounts() {
  plantView.counts = await Promise.all(PLANT_TABS.map(tab =>
    api(plantQuery(1, 1, tab.value)).then(result => result.pagination.total).catch(() => null)));
  drawPlantTabs();
}

// Loads the current page. refreshCounts (default true) also reloads the tab counts, needed
// after the search or filters change (not for paging, sorting or switching tabs).
async function loadPlants(refreshCounts) {
  const request = ++plantView.request;
  byId('plants-error').hidden = true;
  byId('plants-count').textContent = 'Loading plants...';
  drawPlantTabs();
  if (refreshCounts !== false) loadTabCounts().catch(showUnexpectedError);
  try {
    const result = await api(plantQuery(plantView.page, TABLE_PAGE_SIZE));
    if (request !== plantView.request) return;
    if (!result || !Array.isArray(result.data) || !result.pagination) {
      throw new Error('The data could not be read. Please reload the page.');
    }
    plantView.rows = result.data;
    plantView.total = result.pagination.total;
    result.data.forEach(plant => seenPlants.set(plant.id, plant));
    byId('plants-count').textContent = plantView.total.toLocaleString() + ' plant' + (plantView.total === 1 ? '' : 's');
  } catch (error) {
    if (request !== plantView.request) return;
    plantView.rows = [];
    plantView.total = 0;
    byId('plants-error').textContent = 'Plants could not be loaded. ' + (error.message || 'Please try again.');
    byId('plants-error').hidden = false;
    byId('plants-count').textContent = 'Plants unavailable';
  }
  drawPlantTable();
}

// ---- Bulk actions and export ----

const PLANT_CSV_COLUMNS = [
  { label: 'Tag', value: plant => displayTag(plant.tag_code, '') === NO_PHYSICAL_TAG ? '' : displayTag(plant.tag_code, '') },
  { label: 'Scientific name', value: plant => plant.species?.scientific_name || '' },
  { label: 'Common name', value: plant => plant.species?.common_name || '' },
  { label: 'Conservation status', value: plant => statusLabel(plant.species?.conservation_status) },
  { label: 'Location note', value: plant => plant.location_description || '' },
  { label: 'Registered by', value: plant => plant.registered_by || '' },
  { label: 'Last observation', value: plant => (plant.last_observation_at || '').slice(0, 10) },
  { label: 'Status', value: plant => reviewStatusDisplay(plant.plant_status).label },
];

function selectedPlants() {
  return [...plantSelection].map(id => seenPlants.get(id)).filter(Boolean);
}

function exportSelectedPlants() {
  const rows = selectedPlants();
  downloadCsv('niah-plants-selected-' + fileDate() + '.csv', PLANT_CSV_COLUMNS, rows);
  showToast(rows.length + ' plant' + (rows.length === 1 ? '' : 's') + ' exported.');
}

// A PDF sheet of the selected plants' QR labels (POST /api/officer/plants/qr-tags). Plants
// without a NIAH-PLT tag are skipped by the server, which says how many.
async function printSelectedTags() {
  const ids = [...plantSelection];
  if (ids.length > 100) {
    showToast('Choose at most 100 plants to print at once.');
    return;
  }
  try {
    const file = await apiFile('/officer/plants/qr-tags', { method: 'POST', body: JSON.stringify({ plant_ids: ids }) });
    downloadBlob(file.blob, file.name);
    const printed = Number(file.headers.get('X-Printed-Count')) || 0;
    const skipped = Number(file.headers.get('X-Skipped-Count')) || 0;
    showToast('QR tags for ' + printed + ' plant' + (printed === 1 ? '' : 's') + ' downloaded.' +
      (skipped ? ' ' + skipped + ' without a tag ' + (skipped === 1 ? 'was' : 'were') + ' skipped.' : ''));
  } catch (error) {
    showToast('The QR tags could not be printed: ' + error.message);
  }
}

// The Plant records report (GET /api/reports/plants) takes a status and a search; with the
// species, conservation or botanist filters the rows are read here (50 a page) instead.
async function exportPlants(format) {
  const extraFilters = plantView.species || plantView.conservation || plantView.registeredBy;
  if (!extraFilters) {
    const params = new URLSearchParams({ format: format });
    if (plantView.tab) params.set('status', plantView.tab);
    if (plantView.search) params.set('q', plantView.search);
    try {
      const file = await apiFile('/reports/plants?' + params.toString());
      downloadBlob(file.blob, file.name);
      showToast('Plant records downloaded.');
    } catch (error) {
      showToast('The export could not be made: ' + error.message);
    }
    return;
  }
  if (format === 'pdf') {
    showToast('The PDF report covers the tabs and search. Clear the filters for a PDF, or use CSV.');
    return;
  }
  const rows = [];
  for (let page = 1; ; page += 1) {
    const result = await api(plantQuery(page, 50));
    rows.push(...result.data);
    if (page >= result.pagination.total_pages) break;
  }
  downloadCsv('niah-plants-' + fileDate() + '.csv', PLANT_CSV_COLUMNS, rows);
  showToast(rows.length + ' plants exported.');
}

// ---- Filters ----

function replaceOptions(select, firstLabel, rows, valueOf, labelOf, selectedValue) {
  select.replaceChildren(new Option(firstLabel, ''));
  rows.forEach(row => select.add(new Option(labelOf(row), valueOf(row))));
  if (selectedValue && Array.from(select.options).some(option => option.value === selectedValue)) {
    select.value = selectedValue;
  }
}

async function loadFilterOptions() {
  try {
    const [facets, species] = await Promise.all([
      api('/officer/plants/facets'),
      fetchAllPages('/knowledge/species/manage'),
    ]);
    const allSpecies = (species || []).slice().sort((a, b) =>
      (a.scientific_name || '').localeCompare(b.scientific_name || ''));
    replaceOptions(byId('plant-species'), 'All species', allSpecies, item => item.id,
      item => item.scientific_name || item.common_name || 'Unnamed species', plantView.species);
    replaceOptions(byId('registered-by-filter'), 'All botanists', facets.data.registered_by || [],
      item => item.id, item => item.name, '');
  } catch (error) {
    showToast('Some plant filters could not be loaded. ' + (error.message || 'Please refresh.'));
  }
}

function startPlantsPage() {
  byId('plant-search').addEventListener('input', debounce(function () {
    plantView.search = byId('plant-search').value.trim();
    plantView.page = 1;
    loadPlants().catch(showUnexpectedError);
  }));
  for (const [id, key] of [['plant-species', 'species'], ['conservation-filter', 'conservation'], ['registered-by-filter', 'registeredBy']]) {
    byId(id).addEventListener('change', function () {
      plantView[key] = byId(id).value;
      plantView.page = 1;
      loadPlants().catch(showUnexpectedError);
    });
  }
  byId('filters-clear').onclick = function () {
    ['plant-species', 'conservation-filter', 'registered-by-filter'].forEach(id => { byId(id).value = ''; });
    Object.assign(plantView, { species: '', conservation: '', registeredBy: '', page: 1 });
    loadPlants().catch(showUnexpectedError);
  };
  makePopover(byId('filters-button'), byId('filters-panel'));
  const closeExport = makePopover(byId('export-button'), byId('export-panel'));
  byId('export-csv').onclick = function () { closeExport(); exportPlants('csv').catch(showUnexpectedError); };
  byId('export-pdf').onclick = function () { closeExport(); exportPlants('pdf').catch(showUnexpectedError); };
  loadFilterOptions().then(() => loadPlants()).catch(showUnexpectedError);
}

// guardPages redirects anyone else; then no officer plant data is requested.
if (pageAllowed !== false) startPlantsPage();
