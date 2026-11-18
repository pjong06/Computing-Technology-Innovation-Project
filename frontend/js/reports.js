// reports.js - the Reports & export page.

drawMenu('reports.html');

let currentReport = null;
let currentReportKey = '';
let reportRequestNumber = 0;

function selectedReportKey() {
  return [
    document.getElementById('report-type').value,
    document.getElementById('report-from').value,
    document.getElementById('report-to').value
  ].join('|');
}

function reportPeriod(from, to) {
  if (from && to) return from + ' to ' + to;
  if (from) return 'From ' + from;
  if (to) return 'Through ' + to;
  return 'All dates';
}

async function loadReportData() {
  const type = document.getElementById('report-type').value;
  const from = document.getElementById('report-from').value;
  const to = document.getElementById('report-to').value;
  const key = [type, from, to].join('|');
  if (from && to && from > to) {
    throw new Error('The start date must be on or before the end date.');
  }

  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const suffix = params.toString() ? '?' + params.toString() : '';
  const result = await api('/reports/' + type + suffix);
  if (!result || !result.data || !Array.isArray(result.data.columns) || !Array.isArray(result.data.rows)) {
    throw new Error('The report could not be read. Please try again.');
  }
  currentReport = result.data;
  currentReportKey = key;
  return currentReport;
}

async function loadSummary() {
  const result = await api('/reports/summary');
  if (!result || !result.data) {
    throw new Error('The report summary could not be read. Please try again.');
  }
  document.getElementById('stat-species').textContent = result.data.species_count;
  document.getElementById('stat-endangered').textContent = result.data.endangered_count;
  document.getElementById('stat-pending').textContent = result.data.pending_observation_count;
  document.getElementById('stat-plants').textContent = result.data.plant_count;
}

function makeReportCell(column, value) {
  const td = document.createElement('td');
  let text = value === null || value === undefined ? '' : String(value);
  // On screen only: placeholder tags (plant:...) read "No physical tag yet". CSV and PDF
  // exports are built from the report data, so they keep the stored value.
  if (column.key === 'plant_tag' && text) {
    text = displayTag(text, text);
  }
  if (column.key === 'scientific_name' && text) {
    const italic = document.createElement('i');
    italic.className = 'sci';
    italic.textContent = text;
    td.appendChild(italic);
  } else {
    td.textContent = text;
  }
  return td;
}

// The report table's header and body (reports.html: <table id="report-table"> with a
// <thead> and a <tbody>). Returns null when the page doesn't have them.
function reportTableParts() {
  const table = document.getElementById('report-table');
  if (table === null || table.tHead === null || table.tBodies.length === 0) {
    return null;
  }
  return { head: table.tHead, body: table.tBodies[0] };
}

const REPORT_TABLE_MISSING = 'The report table is missing from this page, so the report cannot be shown. Reload the page, or tell the system administrator.';

function drawReport(report) {
  const parts = reportTableParts();
  if (parts === null) {
    document.getElementById('report-note').textContent = REPORT_TABLE_MISSING;
    return;
  }
  document.getElementById('report-note').textContent = report.note || '';
  const head = parts.head;
  const body = parts.body;
  head.replaceChildren();
  body.replaceChildren();

  const headRow = document.createElement('tr');
  report.columns.forEach(column => {
    const th = document.createElement('th');
    th.textContent = column.label;
    headRow.appendChild(th);
  });
  head.appendChild(headRow);

  report.rows.forEach(row => {
    const tr = document.createElement('tr');
    report.columns.forEach(column => tr.appendChild(makeReportCell(column, row[column.key])));
    body.appendChild(tr);
  });
  document.getElementById('report-empty').hidden = report.rows.length > 0;
}

async function renderReport() {
  const requestNumber = ++reportRequestNumber;
  currentReport = null;
  currentReportKey = '';
  const parts = reportTableParts();
  if (parts === null) {
    document.getElementById('report-note').textContent = REPORT_TABLE_MISSING;
    return;
  }
  document.getElementById('report-note').textContent = 'Loading report...';
  parts.head.replaceChildren();
  parts.body.replaceChildren();
  document.getElementById('report-empty').hidden = true;

  try {
    const report = await loadReportData();
    if (requestNumber !== reportRequestNumber) return;
    drawReport(report);
  } catch (error) {
    if (requestNumber !== reportRequestNumber) return;
    document.getElementById('report-note').textContent =
      'The report could not be loaded. Check the date range and try again.';
    showUnexpectedError(error);
  }
}

function reportFileName(report, extension) {
  const names = {
    inventory: 'species-inventory',
    botanist: 'field-observations',
    locations: 'plant-locations'
  };
  return 'niah-' + (names[report.type] || 'report') + '-' + isoDate(new Date()) + '.' + extension;
}

function downloadReportFile(name, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function reportRows(report) {
  return report.rows.map(row => report.columns.map(column => row[column.key] ?? ''));
}

function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+@]/.test(text) || (text.startsWith('-') && !/^-\d/.test(text))) {
    text = "'" + text;
  }
  return '"' + text.replace(/"/g, '""') + '"';
}

async function reportForExport() {
  const key = selectedReportKey();
  if (currentReport && currentReportKey === key) return currentReport;
  return loadReportData();
}

async function exportCsv() {
  try {
    const report = await reportForExport();
    if (report.rows.length === 0) {
      showToast('There are no records to export for this selection.');
      return;
    }
    const lines = [
      report.columns.map(column => csvCell(column.label)).join(','),
      ...reportRows(report).map(row => row.map(csvCell).join(','))
    ];
    downloadReportFile(
      reportFileName(report, 'csv'),
      new Blob(['\uFEFF' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' })
    );
    showToast('CSV downloaded.');
  } catch (error) {
    showUnexpectedError(error);
  }
}

async function exportPdf() {
  try {
    const report = await reportForExport();
    if (report.rows.length === 0) {
      showToast('There are no records to export for this selection.');
      return;
    }
    const pdfReport = {
      title: report.title,
      summary: report.total + ' records · ' + reportPeriod(report.from, report.to),
      columns: report.columns.map(column => ({
        label: column.label,
        w: 1,
        italic: column.key === 'scientific_name'
      })),
      rows: reportRows(report)
    };
    downloadReportFile(
      reportFileName(report, 'pdf'),
      new Blob([makePdf(pdfReport, whenText(new Date()))], { type: 'application/pdf' })
    );
    showToast('PDF downloaded.');
  } catch (error) {
    showUnexpectedError(error);
  }
}

loadSummary().catch(showUnexpectedError);
renderReport().catch(showUnexpectedError);
