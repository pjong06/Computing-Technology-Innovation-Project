// species.js - the Species catalogue page: every species as a row of a data table (no
// photos), with tabs, search, filters, sortable columns, paging and, for the conservation
// officer, bulk changes and exports. The table helpers are shared (shared.js).
// The species come from the real species table (/api/knowledge), the same one the mobile app
// reads. Officers see approved and archived species; botanists see the approved list
// (read only) and request new species instead of adding them.

drawMenu('species.html');

const viewer = getCurrentUser();
const viewerIsOfficer = viewer !== null && isBotanist(viewer) === false;

let speciesList = [];                 // every species the server sent
let plantFacts = new Map();           // species id -> { count, last_observed_at }
let plantFactsLoaded = false;
const speciesSelection = new Set();   // selected species ids
const speciesView = {
  tab: new URLSearchParams(location.search).get('status') === 'threatened' ? 'threatened' : 'all',
  search: '',
  family: '',
  rank: '',
  plants: '',
  sort: { key: 'species', dir: 'asc' },
  page: 1,
};

const byId = id => document.getElementById(id);

// The family of a species (from its taxonomy row), or ''.
function familyOf(species) {
  return species.taxonomy && species.taxonomy.family ? species.taxonomy.family : '';
}

function isArchived(species) {
  return species.verification_status === 'archived';
}

// "Needs info": a species without its family, common name, description or habitat.
function needsInfo(species) {
  return !familyOf(species) || !species.common_name || !species.description || !species.habitat;
}

// The tabs (archived species only appear in their own tab).
const SPECIES_TABS = [
  { value: 'all', label: 'All', test: species => !isArchived(species) },
  { value: 'threatened', label: 'Threatened', test: species => !isArchived(species) && THREATENED_CODES.includes(species.conservation_status) },
  { value: 'not-assessed', label: 'Not assessed', test: species => !isArchived(species) && !species.conservation_status },
  { value: 'needs-info', label: 'Needs info', test: species => !isArchived(species) && needsInfo(species) },
  { value: 'archived', label: 'Archived', test: isArchived, officerOnly: true },
];

function plantCount(species) {
  return plantFacts.get(species.id)?.count || 0;
}

function lastObserved(species) {
  return plantFacts.get(species.id)?.last_observed_at || null;
}

// Status order for sorting: most threatened first, not assessed last.
const STATUS_ORDER = ['CR', 'EN', 'VU', 'NT', 'LC', 'DD'];

const SPECIES_COLUMNS = [
  {
    key: 'species', label: 'Species', className: 'col-species', sortable: true,
    sortValue: species => species.scientific_name,
    render: (td, species) => speciesNameCell(td, species.scientific_name, species.rank, species.common_name),
  },
  {
    key: 'family', label: 'Family', className: 'col-family', sortable: true,
    sortValue: familyOf,
    render: (td, species) => td.appendChild(familyOf(species) ? clippedText(familyOf(species)) : labelSpan('missing-badge', 'Missing')),
  },
  {
    key: 'status', label: 'Conservation status', className: 'col-status', sortable: true,
    sortValue: species => {
      const index = STATUS_ORDER.indexOf(species.conservation_status);
      return index === -1 ? STATUS_ORDER.length : index;
    },
    render: (td, species) => conservationCell(td, species.conservation_status),
  },
  {
    key: 'plants', label: 'Plants', className: 'col-plants', sortable: true, officerOnly: true,
    sortValue: plantCount,
    render: (td, species) => {
      if (!plantFactsLoaded) {
        td.textContent = '…';
        return;
      }
      const count = plantCount(species);
      if (count === 0) {
        td.textContent = '0';
        return;
      }
      // The count opens the Plants list filtered to this species.
      const link = document.createElement('a');
      link.className = 'table-link';
      link.href = 'plants.html?species=' + encodeURIComponent(species.id);
      link.textContent = count.toLocaleString();
      link.setAttribute('aria-label', 'View ' + count + ' plant' + (count === 1 ? '' : 's') + ' of ' + species.scientific_name);
      td.appendChild(link);
    },
  },
  {
    key: 'open', label: '', className: 'col-open', officerOnly: true,
    render: (td, species) => {
      const link = document.createElement('a');
      link.className = 'table-link';
      link.href = '#';
      link.textContent = 'Open';
      link.setAttribute('aria-label', 'Open ' + species.scientific_name + ' in the species editor');
      link.onclick = function (event) {
        event.preventDefault();
        openSpeciesEditor(species.id);
      };
      td.appendChild(link);
    },
  },
].filter(column => viewerIsOfficer || !column.officerOnly);

// The species matching the search box and filters (before the tab).
function filteredSpecies() {
  const needle = speciesView.search.toLowerCase();
  return speciesList.filter(function (species) {
    const names = [species.scientific_name, species.common_name, species.local_name, familyOf(species)]
      .join(' ').toLowerCase();
    if (needle && !names.includes(needle)) return false;
    if (speciesView.family && familyOf(species) !== speciesView.family) return false;
    if (speciesView.rank && species.rank !== speciesView.rank) return false;
    if (speciesView.plants === 'with' && plantCount(species) === 0) return false;
    if (speciesView.plants === 'none' && plantCount(species) > 0) return false;
    return true;
  });
}

function currentTab() {
  return SPECIES_TABS.find(tab => tab.value === speciesView.tab) || SPECIES_TABS[0];
}

// The rows of the current tab, sorted (every page).
function shownSpecies() {
  const column = SPECIES_COLUMNS.find(item => item.key === speciesView.sort.key);
  return sortRows(filteredSpecies().filter(currentTab().test), column, speciesView.sort.dir);
}

function drawSpeciesTable() {
  const matching = filteredSpecies();
  drawTableTabs(byId('species-tabs'),
    SPECIES_TABS.filter(tab => viewerIsOfficer || !tab.officerOnly)
      .map(tab => ({ value: tab.value, label: tab.label, count: matching.filter(tab.test).length })),
    speciesView.tab,
    function (value) {
      speciesView.tab = value;
      speciesView.page = 1;
      drawSpeciesTable();
    });

  const rows = shownSpecies();
  const pages = Math.max(1, Math.ceil(rows.length / TABLE_PAGE_SIZE));
  speciesView.page = Math.min(speciesView.page, pages);
  drawDataTable(byId('species-table'), {
    columns: SPECIES_COLUMNS,
    rows: pageOf(rows, speciesView.page),
    keyOf: species => species.id,
    labelOf: species => species.scientific_name,
    selection: viewerIsOfficer ? speciesSelection : null,
    sort: speciesView.sort,
    onSort: function (key) {
      speciesView.sort = nextSort(speciesView.sort, key);
      drawSpeciesTable();
    },
    onSelect: drawSpeciesTable,
    empty: speciesList.length === 0 ? 'No species yet. Add the first one.' : 'No species match. Clear the search or filters.',
  });
  drawPager(byId('species-pager'), speciesView.page, rows.length, function (page) {
    speciesView.page = page;
    drawSpeciesTable();
  });
  byId('species-count').textContent = rows.length.toLocaleString() + ' species · ' +
    speciesList.filter(species => !isArchived(species)).length.toLocaleString() + ' in the catalogue';
  if (viewerIsOfficer) drawSpeciesBulkBar();
}

// ---- Bulk actions ----

function selectedSpecies() {
  return speciesList.filter(species => speciesSelection.has(species.id));
}

function drawSpeciesBulkBar() {
  const statusOptions = Object.keys(STATUS_LABELS).map(code => ({ value: code, label: STATUS_LABELS[code] }))
    .concat([{ value: 'NA', label: NOT_ASSESSED }]);
  drawBulkBar(byId('species-bulk'), speciesSelection.size, [
    { label: 'Set conservation status', options: statusOptions, onSelect: code => bulkSetStatus(code).catch(showUnexpectedError) },
    { label: 'Set family', onClick: () => bulkSetFamily().catch(showUnexpectedError) },
    { label: 'Export selected', onClick: () => exportSpeciesCsv(selectedSpecies(), 'selected') },
  ], function () {
    speciesSelection.clear();
    drawSpeciesTable();
  });
}

// Runs change(species) for every selected species with the officer species update endpoint
// (PATCH /api/knowledge/species/:id), then reports how many worked.
async function updateSelectedSpecies(change, doneText) {
  const chosen = selectedSpecies();
  let failed = 0;
  let firstError = '';
  for (const species of chosen) {
    try {
      await api('/knowledge/species/' + species.id, { method: 'PATCH', body: JSON.stringify(await change(species)) });
    } catch (error) {
      failed += 1;
      firstError = firstError || error.message;
    }
  }
  const worked = chosen.length - failed;
  showToast(failed === 0
    ? doneText + ' for ' + worked + ' species.'
    : doneText + ' for ' + worked + ' of ' + chosen.length + ' species. ' + failed + ' failed: ' + firstError);
  speciesSelection.clear();
  await loadSpecies();
}

async function bulkSetStatus(code) {
  const words = code === 'NA' ? NOT_ASSESSED : statusLabel(code);
  if (!confirmChange('Set the conservation status of ' + speciesSelection.size + ' species to ' + words + '?')) return;
  await updateSelectedSpecies(() => ({ conservation_status: code === 'NA' ? null : code }), 'Conservation status set to ' + words);
}

async function bulkSetFamily() {
  const family = (prompt('Family for the ' + speciesSelection.size + ' selected species (for example Nepenthaceae):') || '').trim();
  if (family === '') return;
  if (!/^[A-Za-z][A-Za-z -]{1,98}$/.test(family)) {
    showToast('Enter a family name in letters, for example Nepenthaceae.');
    return;
  }
  if (!confirmChange('Set the family of ' + speciesSelection.size + ' species to ' + family + '?')) return;
  const taxonomy = await loadTaxonomy();
  await updateSelectedSpecies(
    async species => ({ taxonomy_id: await taxonomyIdFor(taxonomy, family, species.scientific_name) }),
    'Family set to ' + family
  );
}

// ---- Export ----

const SPECIES_CSV_COLUMNS = [
  { label: 'Scientific name', value: species => species.scientific_name },
  { label: 'Identified to', value: species => species.rank || '' },
  { label: 'Common name', value: species => species.common_name || '' },
  { label: 'Family', value: familyOf },
  { label: 'Conservation status', value: species => statusLabel(species.conservation_status) },
  { label: 'Plants', value: plantCount },
  { label: 'Last observed', value: species => (lastObserved(species) || '').slice(0, 10) },
  { label: 'Catalogue status', value: species => (isArchived(species) ? 'Archived' : 'Approved') },
];

function exportSpeciesCsv(rows, what) {
  downloadCsv('niah-species-' + what + '-' + fileDate() + '.csv', SPECIES_CSV_COLUMNS, rows);
  showToast(rows.length + ' species exported.');
}

// The Species inventory report (GET /api/reports/inventory) covers approved species with a
// status and a search; it is used when the table shows exactly that. Other views (Needs info,
// Archived, extra filters) export the rows shown as a CSV made here.
const REPORT_STATUS_FOR_TAB = { all: '', threatened: 'at_risk', 'not-assessed': 'NA' };

function reportCoversView() {
  return Object.hasOwn(REPORT_STATUS_FOR_TAB, speciesView.tab) &&
    !speciesView.family && !speciesView.rank && !speciesView.plants;
}

async function exportSpecies(format) {
  if (!reportCoversView()) {
    if (format === 'pdf') {
      showToast('The PDF report covers the All, Threatened and Not assessed tabs without extra filters. Use CSV for this view.');
      return;
    }
    exportSpeciesCsv(shownSpecies(), speciesView.tab);
    return;
  }
  const params = new URLSearchParams({ format: format });
  if (REPORT_STATUS_FOR_TAB[speciesView.tab]) params.set('status', REPORT_STATUS_FOR_TAB[speciesView.tab]);
  if (speciesView.search) params.set('q', speciesView.search);
  try {
    const file = await apiFile('/reports/inventory?' + params.toString());
    downloadBlob(file.blob, file.name);
    showToast('Species inventory downloaded.');
  } catch (error) {
    showToast('The export could not be made: ' + error.message);
  }
}

// ---- Loading ----

function fillFilterOptions() {
  const fill = function (select, values, allLabel) {
    const current = select.value;
    select.replaceChildren(new Option(allLabel, ''));
    values.forEach(value => select.add(new Option(value, value)));
    select.value = values.includes(current) ? current : '';
  };
  const families = [...new Set(speciesList.map(familyOf).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const ranks = [...new Set(speciesList.map(species => species.rank).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  fill(byId('family-filter'), families, 'All families');
  fill(byId('rank-filter'), ranks, 'Any rank');
}

// Loads the species. Officers get approved and archived ones; botanists the approved list.
async function loadSpecies() {
  try {
    if (viewerIsOfficer) {
      const all = await fetchAllPages('/knowledge/species/manage');
      // Pending and rejected species are handled on the officer proposal page.
      speciesList = all.filter(species => species.verification_status === 'approved' || isArchived(species));
    } else {
      speciesList = await fetchAllPages('/knowledge/species');
    }
  } catch (error) {
    speciesList = [];
    byId('species-count').textContent = 'Could not load the species: ' + error.message;
    return;
  }
  for (const id of [...speciesSelection]) {
    if (!speciesList.some(species => species.id === id)) speciesSelection.delete(id);
  }
  fillFilterOptions();
  drawSpeciesTable();
}

// Plant count and last observation per species (officer only).
async function loadPlantFacts() {
  try {
    const result = await api('/officer/plants/facets');
    if (!Array.isArray(result?.data?.species_counts)) {
      throw new Error('The data could not be read. Please reload the page.');
    }
    plantFacts = new Map(result.data.species_counts.map(item => [item.species_id, item]));
    plantFactsLoaded = true;
    drawSpeciesTable();
  } catch (error) {
    showToast('Plant counts could not be loaded. ' + error.message);
  }
}

function startSpeciesPage() {
  // Botanists look species up and request new ones; they don't change or export the catalogue.
  if (!viewerIsOfficer) {
    byId('add-species').textContent = 'Request a species';
    byId('export-wrap').hidden = true;
    byId('plants-filter-label').hidden = true;
  }
  byId('search-box').addEventListener('input', debounce(function () {
    speciesView.search = byId('search-box').value.trim();
    speciesView.page = 1;
    drawSpeciesTable();
  }));
  for (const [id, key] of [['family-filter', 'family'], ['rank-filter', 'rank'], ['plants-filter', 'plants']]) {
    byId(id).addEventListener('change', function () {
      speciesView[key] = byId(id).value;
      speciesView.page = 1;
      drawSpeciesTable();
    });
  }
  byId('filters-clear').onclick = function () {
    ['family-filter', 'rank-filter', 'plants-filter'].forEach(id => { byId(id).value = ''; });
    Object.assign(speciesView, { family: '', rank: '', plants: '', page: 1 });
    drawSpeciesTable();
  };
  makePopover(byId('filters-button'), byId('filters-panel'));
  const closeExport = makePopover(byId('export-button'), byId('export-panel'));
  byId('export-csv').onclick = function () { closeExport(); exportSpecies('csv').catch(showUnexpectedError); };
  byId('export-pdf').onclick = function () { closeExport(); exportSpecies('pdf').catch(showUnexpectedError); };

  loadSpecies().catch(showUnexpectedError);
  if (viewerIsOfficer) loadPlantFacts().catch(showUnexpectedError);
}

if (pageAllowed !== false) startSpeciesPage();
