drawMenu('alerts.html');

const filter = document.getElementById('alert-filter');
const refreshButton = document.getElementById('refresh-alerts');
const message = document.getElementById('alert-message');
const list = document.getElementById('alert-list');

const threatNames = {
  high_temperature: 'High temperature',
  low_soil_moisture: 'Low soil moisture',
  motion_detected: 'Motion detected',
  proximity_breach: 'Proximity breach',
  heavy_rain: 'Heavy rain',
};

const sensorUnits = {
  temperature_c: '°C',
  soil_moisture_pct: '%',
  distance_cm: ' cm',
  rain_intensity_pct: '%',
};

let currentRequest = null;

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle('alert-error', isError);
}

function resetResults() {
  document.getElementById('active-count').textContent = '–';
  document.getElementById('critical-count').textContent = '–';
  document.getElementById('warning-count').textContent = '–';
  list.replaceChildren();
}

function formatTime(value) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Not available'
    : date.toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatReading(alert) {
  if (alert.sensor === 'motion_detected') {
    return 'PIR motion detected';
  }

  const unit = sensorUnits[alert.sensor] || '';
  const value = `${alert.value}${unit}`;
  const threshold = alert.threshold === null
    ? 'Not applicable'
    : `${alert.threshold}${unit}`;

  return `Reading: ${value} · Threshold: ${threshold}`;
}

function addDetail(parent, label, value) {
  const row = document.createElement('p');
  row.className = 'alert-detail';
  row.textContent = `${label}: ${value}`;
  parent.appendChild(row);
}

function renderAlert(alert) {
  const card = document.createElement('article');
  card.className = `card alert-card ${alert.severity === 'critical' ? 'alert-critical' : ''}`;

  const heading = document.createElement('div');
  heading.className = 'alert-heading';

  const title = document.createElement('h2');
  title.textContent = threatNames[alert.type] || alert.type;
  heading.appendChild(title);

  const severity = document.createElement('span');
  severity.className = alert.severity === 'critical' ? 'pill e' : 'pill w';
  severity.textContent = alert.severity === 'critical' ? 'Critical' : 'Warning';
  heading.appendChild(severity);

  card.appendChild(heading);

  addDetail(card, 'Station', alert.station_id);
  addDetail(card, 'Status', alert.status === 'active' ? 'Active' : 'Resolved');
  addDetail(card, 'Sensor', formatReading(alert));
  addDetail(card, 'First detected', formatTime(alert.first_detected_at));
  addDetail(card, 'Last detected', formatTime(alert.last_detected_at));
  addDetail(card, 'Occurrences', String(alert.occurrence_count));

  if (alert.status === 'resolved') {
    addDetail(card, 'Resolved', formatTime(alert.resolved_at));
  }

  return card;
}

async function loadAlerts() {
  if (currentRequest) currentRequest.abort();

  // Task 4.1 can provide this function after the officer login is merged.
  // No token is stored or invented by this panel.
  if (typeof window.getOfficerAccessToken !== 'function') {
    resetResults();
    setMessage('Officer sign-in is not connected to this portal yet.', true);
    return;
  }

  let token;
  try {
    token = await window.getOfficerAccessToken();
  } catch {
    resetResults();
    setMessage('Unable to read the officer session. Please sign in again.', true);
    return;
  }

  if (!token) {
    resetResults();
    setMessage('Sign in as a Conservation Officer to view IoT alerts.', true);
    return;
  }

  const controller = new AbortController();
  currentRequest = controller;
  const timeout = setTimeout(() => controller.abort(), 10000);

  refreshButton.disabled = true;
  setMessage('Loading alerts…');

  try {
    const status = encodeURIComponent(filter.value);
    const response = await fetch(`/api/iot/alerts?status=${status}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: controller.signal,
    });

    if (response.status === 401) {
      throw new Error('Your session has expired. Please sign in again.');
    }
    if (response.status === 403) {
      throw new Error('This panel is available to Conservation Officers only.');
    }
    if (!response.ok) {
      throw new Error('Unable to load alerts from the backend.');
    }

    const result = await response.json();
    if (!Array.isArray(result.data) || !result.summary) {
      throw new Error('The backend returned an unexpected alert response.');
    }

    document.getElementById('active-count').textContent = result.summary.active;
    document.getElementById('critical-count').textContent = result.summary.critical;
    document.getElementById('warning-count').textContent = result.summary.warning;

    list.replaceChildren(...result.data.map(renderAlert));
    setMessage(
      result.data.length === 0
        ? `No ${filter.value === 'all' ? '' : filter.value + ' '}alerts to display.`
        : `Showing ${result.data.length} alerts.`
    );
  } catch (error) {
    if (controller.signal.aborted && currentRequest !== controller) return;

    resetResults();
    setMessage(
      controller.signal.aborted
        ? 'The backend did not respond. Try refreshing.'
        : error.message || 'Unable to load alerts.',
      true
    );
  } finally {
    clearTimeout(timeout);
    if (currentRequest === controller) {
      currentRequest = null;
      refreshButton.disabled = false;
    }
  }
}

filter.addEventListener('change', loadAlerts);
refreshButton.addEventListener('click', loadAlerts);

setInterval(() => {
  if (!document.hidden) loadAlerts();
}, 30000);

loadAlerts();