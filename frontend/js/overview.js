// overview.js - the Overview page (officers): summary cards, three panels (species by
// conservation status, field observations per month, IoT protection) and the Report card
// (the former Reports page: tabs, filters, paged table, CSV and PDF).
// Data: GET /api/officer/overview and GET /api/reports/:type (both officer-only). The table
// and the CSV / PDF exports use the same request, so an export contains exactly the current
// tab, filters and search.

drawMenu('overview.html');

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const STATUS_CLASS = { CR: 'critical', EN: 'critical', VU: 'warning', NT: 'near', LC: 'safe' };
// A sensor key in an alert message (letter, underscore, letter: "soil_moisture"). The same
// test as before, without repeated quantifiers.
const SENSOR_KEY = /[a-z]_[a-z]/;

function setOverviewText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = Number(value).toLocaleString();
}

// "+3 this month", only when the server counted it from real dates.
function setMonthLine(id, value) {
  const element = document.getElementById(id);
  if (!element) return;
  const ok = Number.isInteger(value) && value > 0;
  element.hidden = !ok;
  element.textContent = ok ? '+' + value.toLocaleString() + ' this month' : '';
}

// ---- Panel 1: species by conservation status ----
function drawStatusChart(statuses, total) {
  const chart = document.getElementById('species-status-chart');
  const note = document.getElementById('no-status-note');
  if (!chart || !note) return;
  chart.replaceChildren();
  const noStatus = statuses.find(status => status.code === null);
  note.hidden = !(noStatus && total > 0 && noStatus.count > 0);
  if (!note.hidden) {
    note.textContent = Math.round(noStatus.count * 100 / total) + '% of species have no status yet. Assign them in Species.';
  }
  const maximum = Math.max(1, ...statuses.map(status => status.count));
  for (const status of statuses) {
    const row = document.createElement('div');
    row.className = 'overview-status-row';
    const label = document.createElement('span');
    label.className = 'overview-status-name';
    label.textContent = status.label;
    const track = document.createElement('span');
    track.className = 'overview-track';
    track.setAttribute('aria-hidden', 'true');
    const fill = document.createElement('span');
    fill.className = 'overview-fill ' + (STATUS_CLASS[status.code] || 'unknown');
    fill.style.display = 'block';
    fill.style.width = (status.count * 100 / maximum) + '%';
    track.appendChild(fill);
    const count = document.createElement('strong');
    count.textContent = Number(status.count).toLocaleString();
    row.append(label, track, count);
    chart.appendChild(row);
  }
}

// ---- Panel 2: field observations per month (line chart) ----
const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(name, attributes, text) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}

// "Busiest month: October (33). November so far: 24."
function monthlySummary(months, currentMonth) {
  if (!months.length || months.every(month => month.count === 0)) {
    return 'No field observations in the last six months.';
  }
  const busiest = months.reduce((best, month) => (month.count > best.count ? month : best), months[0]);
  const name = month => MONTH_NAMES[Number(month.month.slice(5, 7)) - 1];
  const last = months[months.length - 1];
  const parts = ['Busiest month: ' + name(busiest) + ' (' + busiest.count.toLocaleString() + ').'];
  if (last.month === currentMonth) parts.push(name(last) + ' so far: ' + last.count.toLocaleString() + '.');
  return parts.join(' ');
}

function drawMonthlyChart(months) {
  const chart = document.getElementById('observations-chart');
  const summary = document.getElementById('observations-summary');
  if (!chart) return;
  chart.replaceChildren();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const width = 320;
  const height = 170;
  const left = 14;
  const right = 14;
  const top = 22;
  const bottom = 34;
  const maximum = Math.max(1, ...months.map(month => month.count));
  const step = months.length > 1 ? (width - left - right) / (months.length - 1) : 0;
  const points = months.map((month, index) => ({
    month,
    x: left + index * step,
    y: top + (height - top - bottom) * (1 - month.count / maximum),
  }));
  const root = svg('svg', { viewBox: '0 0 ' + width + ' ' + height, class: 'overview-line', role: 'img',
    'aria-label': months.map(m => MONTH_NAMES[Number(m.month.slice(5, 7)) - 1] + ' ' + m.count).join(', ') });
  root.appendChild(svg('line', { x1: left, x2: width - right, y1: height - bottom, y2: height - bottom, class: 'grid' }));
  // Complete months: a solid line; the current month: dashed ("so far").
  const lastIsCurrent = months.length && months[months.length - 1].month === currentMonth;
  const solid = lastIsCurrent ? points.slice(0, -1) : points;
  if (solid.length > 1) root.appendChild(svg('polyline', { points: solid.map(p => p.x + ',' + p.y).join(' '), class: 'solid' }));
  if (lastIsCurrent && points.length > 1) {
    const [a, b] = points.slice(-2);
    root.appendChild(svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'dashed' }));
  }
  for (const point of points) {
    const isCurrent = point.month.month === currentMonth;
    root.appendChild(svg('circle', { cx: point.x, cy: point.y, r: 3.5 }));
    root.appendChild(svg('text', { x: point.x, y: point.y - 8, 'text-anchor': 'middle', class: 'count' },
      point.month.count.toLocaleString()));
    const short = MONTH_NAMES[Number(point.month.month.slice(5, 7)) - 1].slice(0, 3);
    root.appendChild(svg('text', { x: point.x, y: height - bottom + 15, 'text-anchor': 'middle' }, short));
    if (isCurrent) root.appendChild(svg('text', { x: point.x, y: height - bottom + 28, 'text-anchor': 'middle' }, 'so far'));
  }
  chart.appendChild(root);
  if (summary) summary.textContent = monthlySummary(months, currentMonth);
}

// ---- Panel 3: IoT protection ----
function drawIot(iot) {
  setOverviewText('stations-online', iot.online_stations);
  setOverviewText('stations-total', iot.total_stations);
  setOverviewText('open-alert-count', iot.open_alerts);
  const latest = document.getElementById('latest-alert');
  if (!latest) return;
  // Named latestAlert: "alert" would hide the browser's global alert().
  const latestAlert = iot.latest_alert;
  if (!latestAlert) {
    latest.textContent = 'Latest alert: None recorded';
    return;
  }
  // A raw sensor message (with keys such as soil_moisture) is replaced by its severity.
  const message = latestAlert.alert_message || '';
  const what = message && !SENSOR_KEY.test(message)
    ? message
    : readableValue(latestAlert.severity || '') || 'Alert';
  latest.textContent = 'Latest alert: ' + what + ' · ' + (latestAlert.station_code || 'Unknown station') +
    ' · ' + formatWhen(latestAlert.triggered_at);
}

async function loadOverview() {
  const result = await api('/officer/overview');
  const data = result?.data;
  if (!data || !Array.isArray(data.species_by_status) ||
      !Array.isArray(data.monthly_observations) || !data.iot) {
    throw new Error('The data could not be read. Please reload the page.');
  }
  setOverviewText('approved-species-count', data.approved_species_count);
  setOverviewText('threatened-species-count', data.threatened_species_count);
  setOverviewText('waiting-review-count', data.waiting_review_count);
  setOverviewText('active-plant-count', data.active_plant_count);
  setMonthLine('approved-species-month', data.approved_species_this_month);
  setMonthLine('active-plant-month', data.active_plants_this_month);
  drawStatusChart(data.species_by_status, data.approved_species_count);
  drawMonthlyChart(data.monthly_observations);
  drawIot(data.iot);
}

// ---- The Report card ----

const REPORT_PAGE_SIZE = 10;
const report = { type: 'inventory', range: 'all', status: '', sort: '', q: '', page: 1, data: null, request: 0 };

// The "First recorded" range as dates (YYYY-MM-DD), from the chosen chip.
function reportDates() {
  const today = new Date();
  if (report.range === '30') {
    const start = new Date(today);
    start.setDate(start.getDate() - 29);
    return { from: isoDate(start), to: isoDate(today) };
  }
  if (report.range === 'year') return { from: today.getFullYear() + '-01-01', to: isoDate(today) };
  if (report.range === 'custom') {
    return { from: document.getElementById('report-from').value, to: document.getElementById('report-to').value };
  }
  return { from: '', to: '' };
}

// The request for the current tab, filters and search (the table and both exports use it).
function reportQuery(format) {
  const params = new URLSearchParams();
  const { from, to } = reportDates();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (report.status) params.set('status', report.status);
  if (report.sort) params.set('sort', report.sort);
  if (report.q) params.set('q', report.q);
  if (format) params.set('format', format);
  const query = params.toString();
  return '/reports/' + report.type + (query ? '?' + query : '');
}

function fillSelect(select, options, value, allLabel) {
  select.replaceChildren();
  if (allLabel) select.add(new Option(allLabel, ''));
  for (const option of options) select.add(new Option(option.label, option.value));
  // The chosen value if it is offered; otherwise "All" (when there is one) or the first option.
  let chosen = allLabel ? '' : (options[0]?.value || '');
  if (options.some(option => option.value === value)) chosen = value;
  select.value = chosen;
}

// A <span> with a class and (optional) text: tags, badges, dots and bars in the table.
function labelSpan(className, text) {
  const span = document.createElement('span');
  span.className = className;
  if (text !== undefined) span.textContent = text;
  return span;
}

function statusBadge(td, text, row) {
  if (text) td.appendChild(labelSpan('status-badge ' + (row.status_code || ''), text));
}

function dateCell(td, text) {
  td.textContent = text ? formatDay(text, text) : '—';
}

// How each special column is drawn: (td, text, row, maxPlants). Other columns: plain text.
const CELL_RENDERERS = {
  scientific_name(td, text, row) {
    const name = document.createElement('i');
    name.className = 'sci';
    name.textContent = text;
    td.appendChild(name);
    if (row.rank && row.rank !== 'Species') td.appendChild(labelSpan('rank-tag', row.rank));
  },
  family(td, text) {
    if (text) td.textContent = text;
    else td.appendChild(labelSpan('missing-badge', 'Missing'));
  },
  conservation_status(td, text, row) {
    const dot = labelSpan('status-dot ' + (STATUS_CLASS[row.status_code] || 'unknown'));
    dot.setAttribute('aria-hidden', 'true');
    td.append(dot, text);
  },
  plant_count(td, text, row, maxPlants) {
    const count = Number(text);
    if (count === 0) {
      td.appendChild(labelSpan('no-plants', 'No plants yet'));
      return;
    }
    const bar = labelSpan('');
    bar.style.width = Math.max(4, Math.round(count * 90 / Math.max(1, maxPlants))) + 'px';
    bar.setAttribute('aria-hidden', 'true');
    const wrap = labelSpan('plant-bar');
    wrap.append(bar, document.createTextNode(count.toLocaleString()));
    td.appendChild(wrap);
  },
  plant_status: statusBadge,
  review_status: statusBadge,
  first_recorded: dateCell,
  observed_at: dateCell,
  last_observation: dateCell,
};

function reportCell(column, row, maxPlants) {
  const td = document.createElement('td');
  const value = row[column.key];
  const text = value === null || value === undefined ? '' : String(value);
  const render = CELL_RENDERERS[column.key];
  if (render) render(td, text, row, maxPlants);
  else td.textContent = text;
  return td;
}

function drawReportTable() {
  const data = report.data;
  const table = document.getElementById('report-table');
  const head = table.tHead;
  const body = table.tBodies[0];
  head.replaceChildren();
  body.replaceChildren();
  // On screen the rank is a tag next to the name (the exports have it as a column).
  const columns = data.columns.filter(column => column.key !== 'rank');
  const headRow = document.createElement('tr');
  for (const column of columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = column.label;
    headRow.appendChild(th);
  }
  head.appendChild(headRow);

  const total = data.rows.length;
  const pages = Math.max(1, Math.ceil(total / REPORT_PAGE_SIZE));
  report.page = Math.min(report.page, pages);
  const start = (report.page - 1) * REPORT_PAGE_SIZE;
  const shown = data.rows.slice(start, start + REPORT_PAGE_SIZE);
  const maxPlants = Math.max(0, ...data.rows.map(row => Number(row.plant_count) || 0));
  for (const row of shown) {
    const tr = document.createElement('tr');
    for (const column of columns) tr.appendChild(reportCell(column, row, maxPlants));
    body.appendChild(tr);
  }

  const unit = data.unit || 'rows';
  document.getElementById('report-count').textContent = total === 0
    ? 'No ' + unit
    : 'Showing ' + (start + 1).toLocaleString() + '–' + (start + shown.length).toLocaleString() + ' of ' +
      total.toLocaleString() + ' ' + unit + (report.type === 'inventory' ? ' · counts include all active plants' : '');
  document.getElementById('report-note').textContent = data.filters_text || '';
  document.getElementById('report-empty').hidden = total > 0;
  document.getElementById('report-pager').hidden = pages < 2;
  document.getElementById('report-page').textContent = 'Page ' + report.page + ' of ' + pages;
  document.getElementById('report-previous').disabled = report.page <= 1;
  document.getElementById('report-next').disabled = report.page >= pages;
}

async function loadReport() {
  const { from, to } = reportDates();
  if (from && to && from > to) {
    document.getElementById('report-count').textContent = 'The From date must be on or before the To date.';
    return;
  }
  const request = ++report.request;
  document.getElementById('report-count').textContent = 'Loading…';
  try {
    const result = await api(reportQuery());
    if (request !== report.request) return;
    if (!result?.data || !Array.isArray(result.data.columns) || !Array.isArray(result.data.rows)) {
      throw new Error('The data could not be read. Please reload the page.');
    }
    report.data = result.data;
    fillSelect(document.getElementById('report-status'), result.data.status_options || [], report.status, 'All statuses');
    fillSelect(document.getElementById('report-sort'), result.data.sort_options || [], result.data.sort || report.sort, null);
    drawReportTable();
  } catch (error) {
    if (request !== report.request) return;
    report.data = null;
    document.getElementById('report-table').tHead.replaceChildren();
    document.getElementById('report-table').tBodies[0].replaceChildren();
    document.getElementById('report-count').textContent = error.message || 'The report could not be loaded.';
  }
}

function reloadReport() {
  report.page = 1;
  void loadReport();
}

// CSV / PDF: the same request as the table, as a file.
async function exportReport(format) {
  try {
    const file = await apiFile(reportQuery(format));
    const url = URL.createObjectURL(file.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(format.toUpperCase() + ' downloaded.');
  } catch (error) {
    showToast('The ' + format.toUpperCase() + ' could not be made. ' + error.message);
  }
}

// A group of buttons where one is chosen (tabs: aria-selected; chips: aria-pressed). Marks the
// clicked one and calls onChoose(button).
function chooseOne(selector, attribute, onChoose) {
  const buttons = document.querySelectorAll(selector);
  for (const button of buttons) {
    button.addEventListener('click', () => {
      for (const other of buttons) other.setAttribute(attribute, String(other === button));
      onChoose(button);
    });
  }
}

// Moves the table by one page (step -1 or +1) when that page exists.
function changePage(step) {
  if (!report.data) return;
  const pages = Math.max(1, Math.ceil(report.data.rows.length / REPORT_PAGE_SIZE));
  const page = report.page + step;
  if (page < 1 || page > pages) return;
  report.page = page;
  drawReportTable();
}

function setUpReport() {
  chooseOne('.report-tabs [role="tab"]', 'aria-selected', tab => {
    report.type = tab.dataset.type;
    // Each tab has its own statuses and sort orders.
    report.status = '';
    report.sort = '';
    reloadReport();
  });
  chooseOne('.report-chips [data-range]', 'aria-pressed', chip => {
    report.range = chip.dataset.range;
    document.getElementById('report-custom').hidden = report.range !== 'custom';
    if (report.range !== 'custom') reloadReport();
  });
  for (const id of ['report-from', 'report-to']) {
    document.getElementById(id).addEventListener('change', reloadReport);
  }
  for (const [id, key] of [['report-status', 'status'], ['report-sort', 'sort']]) {
    document.getElementById(id).addEventListener('change', event => {
      report[key] = event.target.value;
      reloadReport();
    });
  }
  let searchTimer = null;
  document.getElementById('report-search').addEventListener('input', event => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      report.q = event.target.value.trim().slice(0, 100);
      reloadReport();
    }, 300);
  });
  document.getElementById('report-previous').addEventListener('click', () => changePage(-1));
  document.getElementById('report-next').addEventListener('click', () => changePage(1));
  document.getElementById('report-csv').addEventListener('click', () => void exportReport('csv'));
  document.getElementById('report-pdf').addEventListener('click', () => void exportReport('pdf'));
}

if (pageAllowed !== false) {
  loadOverview().catch(error => {
    const message = document.getElementById('overview-error');
    if (message) {
      message.hidden = false;
      message.textContent = 'Could not load the overview: ' + error.message;
    }
  });
  setUpReport();
  loadReport();
}
