drawMenu('overview.html');

if (pageAllowed !== false) {
  loadOverview().catch(error => {
    const message = document.getElementById('overview-error');
    if (message) {
      message.hidden = false;
      message.textContent = 'Could not load the overview: ' + error.message;
    }
  });
}

function setOverviewText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = Number(value).toLocaleString();
}

function drawStatusChart(statuses, total) {
  const chart = document.getElementById('species-status-chart');
  const note = document.getElementById('no-status-note');
  if (!chart || !note) return;
  chart.replaceChildren();
  const noStatus = statuses.find(status => status.code === null);
  if (noStatus && total > 0 && noStatus.count / total > 0.5) {
    note.hidden = false;
    note.textContent = Math.round(noStatus.count * 100 / total) +
      '% of species have no status yet. Assign them in Species.';
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
    fill.className = 'overview-fill ' + statusClass(status.label);
    fill.style.display = 'block';
    fill.style.width = (status.count * 100 / maximum) + '%';
    track.appendChild(fill);
    const count = document.createElement('strong');
    count.textContent = Number(status.count).toLocaleString();
    row.append(label, track, count);
    chart.appendChild(row);
  }
}

function drawMonthlyChart(months) {
  const chart = document.getElementById('observations-chart');
  if (!chart) return;
  chart.replaceChildren();
  const maximum = Math.max(1, ...months.map(month => month.count));
  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (const item of months) {
    const [year, monthNumber] = item.month.split('-').map(Number);
    const month = document.createElement('div');
    month.className = 'overview-month';
    const track = document.createElement('span');
    track.className = 'overview-month-track';
    const fill = document.createElement('span');
    fill.className = 'overview-month-fill';
    fill.style.height = (item.count * 100 / maximum) + '%';
    fill.title = item.count + ' observations';
    track.appendChild(fill);
    const count = document.createElement('strong');
    count.className = 'overview-month-count';
    count.textContent = Number(item.count).toLocaleString();
    const label = document.createElement('span');
    label.textContent = monthNames[monthNumber - 1] + (item.month === currentMonth ? ' so far' : '');
    label.setAttribute('aria-label', monthNames[monthNumber - 1] + ' ' + year +
      (item.month === currentMonth ? ', so far' : ''));
    month.append(track, count, label);
    chart.appendChild(month);
  }
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
  setOverviewText('stations-online', data.iot.online_stations);
  setOverviewText('stations-total', data.iot.total_stations);
  setOverviewText('open-alert-count', data.iot.open_alerts);
  drawStatusChart(data.species_by_status, data.approved_species_count);
  drawMonthlyChart(data.monthly_observations);

  const latest = document.getElementById('latest-alert');
  if (latest) {
    if (data.iot.latest_alert) {
      latest.textContent = 'Latest alert: ' +
        (data.iot.latest_alert.alert_message || data.iot.latest_alert.severity || 'Alert') +
        ' · ' + formatWhen(data.iot.latest_alert.triggered_at);
    } else {
      latest.textContent = 'Latest alert: None recorded';
    }
  }
}
