// reports.js - the Reports & export page.

drawMenu('reports.html');

const STATUS_ORDER = ['Endangered', 'Vulnerable', 'Least Concern'];

// Turns "2026-09-14" into "14 Sep 2026".
function prettyDate(dateText) {
  if (!dateText) {
    return '';
  }
  const parts = dateText.split('-');
  if (parts.length !== 3) {
    return dateText;
  }
  const day = Number(parts[2]);
  const monthName = MONTHS[Number(parts[1]) - 1];
  return day + ' ' + monthName + ' ' + parts[0];
}

// Returns the count with the word, adding an "s" unless the count is 1.
function pluralize(count, word) {
  if (count === 1) {
    return count + ' ' + word;
  }
  return count + ' ' + word + 's';
}

// Returns every species record.
function speciesList() {
  return getSpecies();
}

// Returns every observation (waiting, approved and rejected) with its review status as text.
function observationList() {
  const all = getObservations();
  const list = [];
  for (let i = 0; i < all.length; i++) {
    const o = all[i];
    list.push({
      id: o.id, sci: o.sci, by: o.by, date: o.date,
      when: o.when, loc: o.loc, gps: o.gps, state: reviewText(o)
    });
  }
  return list;
}

// Returns each scientific name only once, because one species can have records at several locations.
function uniqueNames(speciesRecords) {
  const names = [];
  for (let i = 0; i < speciesRecords.length; i++) {
    let found = false;
    for (let j = 0; j < names.length; j++) {
      if (sameText(names[j], speciesRecords[i].sci)) {
        found = true;
      }
    }
    if (found === false) {
      names.push(speciesRecords[i].sci);
    }
  }
  return names;
}

// Returns the date range as text, like "1 Sep 2026 to 12 Oct 2026".
function periodText(from, to) {
  let startText = 'start';
  if (from) {
    startText = prettyDate(from);
  }
  let endText = 'today';
  if (to) {
    endText = prettyDate(to);
  }
  return startText + ' to ' + endText;
}

// Checks if a date is inside the date range. A record with no date is always included.
function dateInRange(date, from, to) {
  if (!date) {
    return true;
  }
  if (from && date < from) {
    return false;
  }
  if (to && date > to) {
    return false;
  }
  return true;
}

// Fills in the Species inventory report. Only species first recorded inside the date range are listed.
function buildInventoryReport(report, from, to) {
  report.title = 'Species inventory';
  report.note = 'The date range uses the date each species was first recorded.';
  report.columns = [
    { label: 'Scientific name', w: 1.4, italic: true },
    { label: 'Common name', w: 1.3 },
    { label: 'Family', w: 1.45 },
    { label: 'Status', w: 1.1, pill: true },
    { label: 'Location', w: 1.3 },
    { label: 'GPS (lat, lng)', w: 1.1 },
    { label: 'First recorded', w: 1.8 },
    { label: 'Last updated', w: 1.8 },
    { label: 'Description', w: 2.1, hide: true }
  ];

  if (from && to && from > to) {
    report.note = 'The start date is after the end date.';
  } else {
    const species = speciesList();
    for (let i = 0; i < species.length; i++) {
      const s = species[i];
      if (dateInRange(s.firstDate, from, to) === false) {
        continue;
      }
      let firstText = s.firstWhen;
      if (!firstText) {
        firstText = 'Not recorded';
      }
      let lastText = s.when;
      if (!lastText) {
        lastText = 'Not recorded';
      }
      report.rows.push([s.sci, s.com, s.fam, s.status, s.loc, s.gps, firstText, lastText, s.desc]);
    }
  }
  report.summary = pluralize(report.rows.length, 'species record') + ' · ' + periodText(from, to);
}

// Fills in the Conservation status summary. Each species is counted once and the date range is not used.
function buildStatusReport(report) {
  const species = speciesList();
  report.title = 'Conservation status summary';
  report.note = 'Each species is counted once, even if it has records at several locations. The date range does not apply.';
  report.columns = [
    { label: 'Status', w: 1, pill: true },
    { label: 'Species', w: 0.7 },
    { label: 'Scientific names', w: 4 }
  ];

  for (let i = 0; i < STATUS_ORDER.length; i++) {
    const withThisStatus = [];
    for (let j = 0; j < species.length; j++) {
      if (species[j].status === STATUS_ORDER[i]) {
        withThisStatus.push(species[j]);
      }
    }
    const names = uniqueNames(withThisStatus);
    report.rows.push([STATUS_ORDER[i], String(names.length), names.join('; ')]);
  }
  report.rows.push(['Total', String(uniqueNames(species).length), '']);
  report.summary = pluralize(uniqueNames(species).length, 'species');
}

// Used to sort observations: by botanist name, then newest date first.
function compareObservations(a, b) {
  if (a.by < b.by) {
    return -1;
  }
  if (a.by > b.by) {
    return 1;
  }
  if (a.date < b.date) {
    return 1;
  }
  if (a.date > b.date) {
    return -1;
  }
  return 0;
}

// Fills in the Observations by botanist report for the date range.
function buildBotanistReport(report, from, to) {
  report.title = 'Observations by botanist';
  report.columns = [
    { label: 'Botanist', w: 1.1 },
    { label: 'Record', w: 1.1 },
    { label: 'Species', w: 1.5, italic: true },
    { label: 'Recorded', w: 1.4 },
    { label: 'Location', w: 1.3 },
    { label: 'GPS (lat, lng)', w: 1.2 },
    { label: 'Review status', w: 0.9 }
  ];

  const period = periodText(from, to);

  if (from && to && from > to) {
    report.note = 'The start date is after the end date.';
  } else {
    const all = observationList();
    const inRange = [];
    for (let i = 0; i < all.length; i++) {
      const o = all[i];
      if (from && o.date < from) {
        continue;
      }
      if (to && o.date > to) {
        continue;
      }
      inRange.push(o);
    }

    inRange.sort(compareObservations);
    for (let i = 0; i < inRange.length; i++) {
      const o = inRange[i];
      report.rows.push([o.by, o.id, o.sci, o.when, o.loc, o.gps, o.state]);
    }
  }
  report.summary = pluralize(report.rows.length, 'observation') + ' · ' + period;
}

// Builds the report that is selected on the page.
// A report is an object with: key, title, summary, note,
// columns (label, w = width, italic, pill, hide) and rows (a list of texts for each row).
function buildReport() {
  const key = document.getElementById('report-type').value;
  const from = document.getElementById('report-from').value;
  const to = document.getElementById('report-to').value;

  const report = { key: key, title: '', summary: '', note: '', columns: [], rows: [] };

  if (key === 'inventory') {
    buildInventoryReport(report, from, to);
  } else if (key === 'status') {
    buildStatusReport(report);
  } else {
    buildBotanistReport(report, from, to);
  }
  return report;
}

// Shows the number cards at the top of the page. Each species is counted once.
function showNumberCards() {
  const species = speciesList();
  const endangered = [];
  for (let i = 0; i < species.length; i++) {
    if (species[i].status === 'Endangered') {
      endangered.push(species[i]);
    }
  }

  document.getElementById('stat-species').textContent = uniqueNames(species).length;
  document.getElementById('stat-endangered').textContent = uniqueNames(endangered).length;
  let pending = 0;
  const observations = getObservations();
  for (let i = 0; i < observations.length; i++) {
    if (observations[i].state === 'Pending') {
      pending = pending + 1;
    }
  }
  document.getElementById('stat-pending').textContent = pending;
}

// Makes one table cell of the report preview: a pill for a status, italics for a scientific name.
function makeReportCell(column, value) {
  const td = document.createElement('td');

  if (column.pill && STATUS_ORDER.includes(value)) {
    const pill = document.createElement('span');
    pill.textContent = value;
    if (value === 'Endangered') {
      pill.className = 'pill e';
    } else if (value === 'Vulnerable') {
      pill.className = 'pill w';
    } else {
      pill.className = 'pill';
    }
    td.appendChild(pill);
  } else if (column.italic) {
    const italic = document.createElement('i');
    italic.className = 'sci';
    italic.textContent = value;
    td.appendChild(italic);
  } else {
    td.textContent = value;
  }
  return td;
}

// Draws the number cards and the report preview table.
function renderReport() {
  showNumberCards();

  const report = buildReport();
  document.getElementById('report-note').textContent = report.note;

  const head = document.getElementById('report-head');
  const body = document.getElementById('report-body');
  head.innerHTML = '';
  body.innerHTML = '';

  const headRow = document.createElement('tr');
  for (let c = 0; c < report.columns.length; c++) {
    if (report.columns[c].hide) {
      continue;
    }
    const th = document.createElement('th');
    th.textContent = report.columns[c].label;
    headRow.appendChild(th);
  }
  head.appendChild(headRow);

  for (let r = 0; r < report.rows.length; r++) {
    const tr = document.createElement('tr');
    for (let c = 0; c < report.columns.length; c++) {
      if (report.columns[c].hide) {
        continue;
      }
      tr.appendChild(makeReportCell(report.columns[c], report.rows[r][c]));
    }
    body.appendChild(tr);
  }

  document.getElementById('report-empty').hidden = (report.rows.length > 0);
}

// Returns the name of the file to download, like "niah-species-inventory-2026-10-12.csv".
function fileName(report, extension) {
  const today = new Date();
  const stamp = isoDate(today);
  const names = {
    inventory: 'species-inventory',
    status: 'conservation-status-summary',
    botanist: 'observations-by-botanist'
  };
  return 'niah-' + names[report.key] + '-' + stamp + '.' + extension;
}

// Makes the browser download a file (used for the CSV and the PDF).
function downloadFile(name, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function () {
    URL.revokeObjectURL(url);
  }, 1000);
}

// Checks if a character is a number from 0 to 9.
function isDigit(character) {
  return character >= '0' && character <= '9';
}

// Puts a value inside quotes so commas and line breaks cannot break the CSV.
// Text that starts like a formula (= + @ -) gets a quote in front so Excel does not run it.
function csvCell(value) {
  let text = '';
  if (value !== null && value !== undefined) {
    text = String(value);
  }

  const first = text.charAt(0);
  if (first === '=' || first === '+' || first === '@') {
    text = "'" + text;
  }
  if (first === '-' && isDigit(text.charAt(1)) === false) {
    text = "'" + text;
  }

  text = text.split('"').join('""');
  return '"' + text + '"';
}

// Builds the CSV file for the selected report and downloads it.
function exportCsv() {
  const report = buildReport();
  if (report.rows.length === 0) {
    showToast('Nothing to export for this selection');
    return;
  }

  const lines = [];

  const labels = [];
  for (let c = 0; c < report.columns.length; c++) {
    labels.push(csvCell(report.columns[c].label));
  }
  lines.push(labels.join(','));

  for (let r = 0; r < report.rows.length; r++) {
    const cells = [];
    for (let c = 0; c < report.columns.length; c++) {
      cells.push(csvCell(report.rows[r][c]));
    }
    lines.push(cells.join(','));
  }

  const text = '\uFEFF' + lines.join('\r\n') + '\r\n';
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  downloadFile(fileName(report, 'csv'), blob);
  showToast('CSV downloaded');
}

// Builds the PDF file for the selected report (using makePdf in pdf.js) and downloads it.
function exportPdf() {
  const report = buildReport();
  if (report.rows.length === 0) {
    showToast('Nothing to export for this selection');
    return;
  }

  const now = new Date();
  const generated = whenText(now);

  const bytes = makePdf(report, generated);
  downloadFile(fileName(report, 'pdf'), new Blob([bytes], { type: 'application/pdf' }));
  showToast('PDF downloaded');
}

document.getElementById('report-to').value = isoDate(new Date());

renderReport();
