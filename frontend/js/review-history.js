// review-history.js - the Review history page (officers): every decision on field records
// (Approved / Sent back) and species requests (Added / Not added), newest first, from
// GET /api/officer/reviews/history (officer only). Search, Type, Officer, date range,
// Decision chips with counts, sort, paging (10 a page) and a CSV of the filtered list.

drawMenu('review-history.html');

const DECISION_WORDS = { approved: 'Approved', sent_back: 'Sent back', added: 'Added', not_added: 'Not added' };
// Status badge colours: positive decisions green, the others red (shared .status-badge).
const DECISION_CLASS = { approved: 'approved', sent_back: 'rejected', added: 'approved', not_added: 'rejected' };
const KIND_WORDS = { new_plant: 'NEW PLANT', observation: 'OBSERVATION', species_request: 'SPECIES REQUEST' };
const KIND_CLASS = { new_plant: 'new-plant', observation: 'observation', species_request: 'species-request' };

const historyView = {
  q: '', type: '', officer: '', range: 'all', decision: '', sort: 'newest', page: 1,
  request: 0, officersLoaded: false,
};
const byId = id => document.getElementById(id);

// The date range of the chosen chip, as YYYY-MM-DD.
function historyDates() {
  const today = new Date();
  const daysBack = days => {
    const start = new Date(today);
    start.setDate(start.getDate() - (days - 1));
    return { from: isoDate(start), to: isoDate(today) };
  };
  if (historyView.range === '7') return daysBack(7);
  if (historyView.range === '30') return daysBack(30);
  if (historyView.range === 'year') return { from: today.getFullYear() + '-01-01', to: isoDate(today) };
  if (historyView.range === 'custom') return { from: byId('history-from').value, to: byId('history-to').value };
  return { from: '', to: '' };
}

function historyQuery(page, pageSize) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize), sort: historyView.sort });
  const { from, to } = historyDates();
  const optional = { q: historyView.q, type: historyView.type, officer: historyView.officer, decision: historyView.decision, from, to };
  for (const [key, value] of Object.entries(optional)) if (value) params.set(key, value);
  return '/officer/reviews/history?' + params.toString();
}

// ---- cells ----

function thumbCell(td, row) {
  if (row.kind === 'species_request') {
    const icon = labelSpan('history-icon', '📖');
    icon.setAttribute('role', 'img');
    icon.setAttribute('aria-label', 'Species request');
    td.appendChild(icon);
    return;
  }
  const image = document.createElement('img');
  image.className = 'row-thumb';
  image.alt = '';
  image.loading = 'lazy';
  image.src = row.thumbnail_url || PICTURE_BLANK;
  image.onerror = function () {
    image.onerror = null;
    image.src = PICTURE_BLANK;
  };
  td.appendChild(image);
}

function recordCell(td, row) {
  td.appendChild(labelSpan('review-kind ' + KIND_CLASS[row.kind], KIND_WORDS[row.kind]));
  const name = labelSpan('cell-line');
  name.appendChild(clippedText(row.scientific_name || 'Species not recorded', 'sci'));
  td.appendChild(name);
  const who = row.kind === 'species_request'
    ? 'Requested by ' + (row.botanist || 'Unknown')
    : [displayTag(row.tag, 'No tag yet'), row.botanist || 'Unknown botanist'].join(' · ');
  td.appendChild(clippedText(who, 'cell-sub'));
}

function decisionCell(td, row) {
  const badge = labelSpan('status-badge ' + DECISION_CLASS[row.decision], DECISION_WORDS[row.decision]);
  badge.title = DECISION_WORDS[row.decision];
  td.appendChild(badge);
}

function decidedCell(td, row) {
  td.appendChild(clippedText(row.decided_at ? formatWhen(row.decided_at) : 'Date not recorded', 'cell-line'));
  if (row.decided_by) td.appendChild(clippedText('by ' + row.decided_by, 'cell-sub'));
}

function reasonCell(td, row) {
  if (row.reason) td.appendChild(clippedText(row.reason, '', 2));
  else td.textContent = '—';
}

function openCell(td, row) {
  const link = document.createElement('a');
  link.className = 'table-link';
  link.textContent = 'Open';
  if (row.kind === 'species_request') {
    link.href = '#';
    link.setAttribute('aria-label', 'Open the species request ' + (row.scientific_name || ''));
    link.onclick = function (event) {
      event.preventDefault();
      openSpeciesEditor(row.species_id);
    };
  } else if (row.plant_id) {
    link.href = 'plant.html?id=' + encodeURIComponent(row.plant_id);
    link.setAttribute('aria-label', 'Open the plant ' + displayTag(row.tag, row.scientific_name || ''));
  } else {
    td.textContent = '—';
    return;
  }
  td.appendChild(link);
}

const HISTORY_COLUMNS = [
  { key: 'thumb', label: 'Photo', className: 'col-thumb', render: thumbCell },
  { key: 'record', label: 'Record', className: 'col-record', render: recordCell },
  { key: 'decision', label: 'Decision', className: 'col-decision', render: decisionCell },
  { key: 'decided', label: 'Decided', className: 'col-decided', render: decidedCell },
  { key: 'reason', label: 'Reason', className: 'col-reason', render: reasonCell },
  { key: 'open', label: 'Open', className: 'col-open', render: openCell },
];

// ---- drawing ----

// The Decision chips with counts; Added / Not added only for species requests.
function drawDecisionChips(counts) {
  const chips = [
    { value: '', label: 'All', count: counts.all },
    { value: 'approved', label: 'Approved', count: counts.approved },
    { value: 'sent_back', label: 'Sent back', count: counts.sent_back },
  ];
  if (historyView.type === 'species_request') {
    chips.length = 1;
    chips.push({ value: 'added', label: 'Added', count: counts.added }, { value: 'not_added', label: 'Not added', count: counts.not_added });
  }
  drawTableTabs(byId('history-decisions'), chips, historyView.decision, value => {
    historyView.decision = value;
    historyView.page = 1;
    void loadHistory();
  });
}

function fillOfficers(officers) {
  if (historyView.officersLoaded) return;
  const select = byId('history-officer');
  for (const officer of officers) select.add(new Option(officer.name, officer.id));
  historyView.officersLoaded = true;
}

async function loadHistory() {
  const { from, to } = historyDates();
  if (from && to && from > to) {
    byId('history-count').textContent = 'The From date must be on or before the To date.';
    return;
  }
  const request = ++historyView.request;
  byId('history-error').hidden = true;
  try {
    const result = await api(historyQuery(historyView.page, TABLE_PAGE_SIZE));
    if (request !== historyView.request) return;
    if (!result || !Array.isArray(result.data) || !result.pagination || !result.counts) {
      throw new Error('The data could not be read. Please reload the page.');
    }
    fillOfficers(result.officers || []);
    drawDecisionChips(result.counts);
    drawDataTable(byId('history-table'), {
      columns: HISTORY_COLUMNS,
      rows: result.data,
      keyOf: row => row.id,
      empty: 'No decisions match these filters.',
    });
    const total = result.pagination.total;
    byId('history-count').textContent = total === 1 ? '1 decision' : total.toLocaleString() + ' decisions';
    drawPager(byId('history-pager'), historyView.page, total, page => {
      historyView.page = page;
      void loadHistory();
    }, 'decisions');
  } catch (error) {
    if (request !== historyView.request) return;
    byId('history-error').hidden = false;
    byId('history-error').textContent = 'The review history could not be loaded. ' + error.message;
    byId('history-count').textContent = '';
  }
}

// CSV of the whole filtered list (all pages).
const HISTORY_CSV_COLUMNS = [
  { label: 'Type', value: row => KIND_WORDS[row.kind] },
  { label: 'Species', value: row => row.scientific_name || '' },
  { label: 'Plant tag', value: row => (row.kind === 'species_request' ? '' : displayTag(row.tag, 'No tag yet')) },
  { label: 'Botanist', value: row => row.botanist || '' },
  { label: 'Decision', value: row => DECISION_WORDS[row.decision] },
  { label: 'Decided', value: row => (row.decided_at ? formatWhen(row.decided_at) : '') },
  { label: 'Decided by', value: row => row.decided_by || '' },
  { label: 'Reason', value: row => row.reason || '' },
];

async function exportHistory() {
  try {
    const result = await api(historyQuery(1, 1000));
    const rows = Array.isArray(result?.data) ? result.data : [];
    downloadCsv('niah-review-history-' + fileDate() + '.csv', HISTORY_CSV_COLUMNS, rows);
    showToast(rows.length + (rows.length === 1 ? ' decision' : ' decisions') + ' exported.');
  } catch (error) {
    showToast('The export could not be made. ' + error.message);
  }
}

function reload() {
  historyView.page = 1;
  void loadHistory();
}

function setUpHistory() {
  byId('history-search').addEventListener('input', debounce(function () {
    historyView.q = byId('history-search').value.trim().slice(0, 100);
    reload();
  }, 300));
  byId('history-type').addEventListener('change', function () {
    historyView.type = byId('history-type').value;
    // Added / Not added belong to species requests; Approved / Sent back to field records.
    historyView.decision = '';
    reload();
  });
  for (const [id, key] of [['history-officer', 'officer'], ['history-sort', 'sort']]) {
    byId(id).addEventListener('change', function () {
      historyView[key] = byId(id).value;
      reload();
    });
  }
  const chips = document.querySelectorAll('.history-dates [data-range]');
  for (const chip of chips) {
    chip.addEventListener('click', function () {
      for (const other of chips) other.setAttribute('aria-pressed', String(other === chip));
      historyView.range = chip.dataset.range;
      byId('history-custom').hidden = historyView.range !== 'custom';
      if (historyView.range !== 'custom') reload();
    });
  }
  for (const id of ['history-from', 'history-to']) byId(id).addEventListener('change', reload);
  byId('history-export').addEventListener('click', () => void exportHistory());
}

if (pageAllowed !== false) {
  setUpHistory();
  void loadHistory();
}
