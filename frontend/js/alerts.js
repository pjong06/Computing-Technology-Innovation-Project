drawMenu('alerts.html');

/*
 * ============================================================
 * NIAH BIOTRACK - IOT MONITORING DASHBOARD
 * ============================================================
 *
 * Persistent / database data:
 *   GET /api/iot/summary
 *   GET /api/iot/alerts
 *
 * Live MQTT / backend-memory data:
 *   GET /api/iot/summary/live
 *   GET /api/iot/latest
 *   GET /api/iot/readings
 *   GET /api/iot/alerts/live
 *
 * Alert workflow:
 *   PATCH /api/iot/alerts/:id/acknowledge
 *   PATCH /api/iot/alerts/:id/resolve
 *
 * Active staff roles may read the dashboard and manage
 * the supported alert lifecycle.
 * ============================================================
 */


/* ============================================================
   DOM
   ============================================================ */

const refreshButton =
  document.getElementById('refresh-dashboard');

const dashboardStatus =
  document.getElementById('dashboard-status');

const lastUpdated =
  document.getElementById('last-updated');

const stationFilter =
  document.getElementById('station-filter');


const stationCount =
  document.getElementById('station-count');

const onlineCount =
  document.getElementById('online-count');

const offlineCount =
  document.getElementById('offline-count');

const activeAlertCount =
  document.getElementById('active-alert-count');


const selectedStationId =
  document.getElementById('selected-station-id');

const stationLastSeen =
  document.getElementById('station-last-seen');

const stationSequence =
  document.getElementById('station-sequence');


const sensorTemperature =
  document.getElementById('sensor-temperature');

const sensorHumidity =
  document.getElementById('sensor-humidity');

const sensorSoil =
  document.getElementById('sensor-soil');

const sensorMotion =
  document.getElementById('sensor-motion');

const sensorDistance =
  document.getElementById('sensor-distance');

const sensorRain =
  document.getElementById('sensor-rain');


const temperatureStatus =
  document.getElementById('temperature-status');

const humidityStatus =
  document.getElementById('humidity-status');

const soilStatus =
  document.getElementById('soil-status');

const motionStatus =
  document.getElementById('motion-status');

const distanceStatus =
  document.getElementById('distance-status');

const rainStatus =
  document.getElementById('rain-status');


const telemetryMessage =
  document.getElementById('telemetry-message');

const telemetryBody =
  document.getElementById('telemetry-body');


const alertFilter =
  document.getElementById('alert-filter');

const alertMessage =
  document.getElementById('alert-message');

const alertList =
  document.getElementById('alert-list');

const criticalCount =
  document.getElementById('critical-count');

const warningCount =
  document.getElementById('warning-count');


/* ============================================================
   STATE
   ============================================================ */

const AUTO_REFRESH_MS = 5000;

const ONLINE_WINDOW_MS =
  60 * 1000;


let latestReadings = [];

let recentReadings = [];

/*
 * Persistent alerts from Supabase.
 */
let persistentAlerts = [];

/*
 * Live alerts produced by iotAlertService.
 *
 * These are used for live sensor-card warning states.
 */
let liveActiveAlerts = [];


let dashboardSummary = {
  total_stations: 0,
  online_stations: 0,
  offline_stations: 0,
};


let alertSummary = {
  unresolved: 0,
  critical: 0,
  warning: 0,
};


let selectedStation = '';

let currentRequest = null;

let refreshTimer = null;


/*
 * Keeps resolution text safe while the 5-second dashboard
 * refresh is running.
 */
const resolutionDrafts =
  new Map();


/*
 * Prevent duplicate alert actions while a request is running.
 */
const alertActionsInProgress =
  new Set();


/* ============================================================
   GENERAL HELPERS
   ============================================================ */

function formatNumber(
  value,
  digits = 1
) {
  const number =
    Number(value);

  if (!Number.isFinite(number)) {
    return '–';
  }

  return number.toFixed(digits);
}


function formatTime(value) {
  if (!value) {
    return 'Not available';
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return 'Not available';
  }

  return date.toLocaleString(
    'en-MY',
    {
      dateStyle: 'medium',
      timeStyle: 'medium',
    }
  );
}


function formatShortTime(value) {
  if (!value) {
    return '–';
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return '–';
  }

  return date.toLocaleTimeString(
    'en-MY',
    {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }
  );
}


function capitalise(value) {
  if (!value) {
    return 'Unknown';
  }

  return (
    String(value)
      .charAt(0)
      .toUpperCase() +
    String(value).slice(1)
  );
}


function getHumidity(reading) {
  return (
    reading?.humidity_pct ??
    reading?.humidity_percent
  );
}


function getMotion(reading) {
  return (
    reading?.motion_detected ??
    reading?.movement_detected
  );
}


function getReadingTime(reading) {
  return (
    reading?.received_at ??
    reading?.recorded_at
  );
}


function isReadingOnline(reading) {
  if (
    !reading ||
    !getReadingTime(reading)
  ) {
    return false;
  }

  const timestamp =
    new Date(
      getReadingTime(reading)
    ).getTime();

  if (
    Number.isNaN(timestamp)
  ) {
    return false;
  }

  return (
    Date.now() - timestamp <=
    ONLINE_WINDOW_MS
  );
}


function normalisePersistentStatus(
  status
) {
  /*
   * Compatibility with any old prototype data.
   */
  if (status === 'active') {
    return 'open';
  }

  return status || 'open';
}


function isUnresolvedAlert(alert) {
  const status =
    normalisePersistentStatus(
      alert.alert_status
    );

  return (
    status === 'open' ||
    status === 'acknowledged'
  );
}


function isCriticalSeverity(
  severity
) {
  const value =
    String(
      severity || ''
    ).toLowerCase();

  return (
    value === 'critical' ||
    value === 'high'
  );
}


function createCell(text) {
  const cell =
    document.createElement('td');

  cell.textContent =
    text;

  return cell;
}


function notify(message) {
  if (
    typeof showToast ===
    'function'
  ) {
    showToast(message);
  }
}


/* ============================================================
   AUTH + API
   ============================================================ */

async function getAccessToken() {
  if (
    typeof window
      .getOfficerAccessToken !==
    'function'
  ) {
    throw new Error(
      'Authentication is not connected.'
    );
  }

  const token =
    await window
      .getOfficerAccessToken();

  if (!token) {
    throw new Error(
      'Please sign in to access IoT monitoring.'
    );
  }

  return token;
}


async function requestIoT(
  path,
  token,
  options = {}
) {
  const headers = {
    Authorization:
      `Bearer ${token}`,
  };

  if (
    options.body !==
    undefined
  ) {
    headers['Content-Type'] =
      'application/json';
  }


  const response =
    await fetch(
      `/api/iot${path}`,
      {
        method:
          options.method ||
          'GET',

        headers,

        body:
          options.body ===
          undefined
            ? undefined
            : JSON.stringify(
                options.body
              ),

        cache:
          'no-store',

        signal:
          options.signal,
      }
    );


  let body = {};

  try {
    body =
      await response.json();
  } catch {
    body = {};
  }


  if (
    response.status ===
    401
  ) {
    throw new Error(
      'Your session has expired. Please sign in again.'
    );
  }


  if (
    response.status ===
    403
  ) {
    throw new Error(
      'Your account does not have permission to access this IoT operation.'
    );
  }


  if (!response.ok) {
    throw new Error(
      body.message ||
      `IoT request failed (${response.status}).`
    );
  }


  return body;
}


/* ============================================================
   DASHBOARD CONNECTION STATUS
   ============================================================ */

function setDashboardStatus(
  state,
  text
) {
  dashboardStatus.classList.remove(
    'iot-status-live',
    'iot-status-loading',
    'iot-status-error'
  );


  if (state === 'live') {
    dashboardStatus.classList.add(
      'iot-status-live'
    );
  } else if (
    state === 'loading'
  ) {
    dashboardStatus.classList.add(
      'iot-status-loading'
    );
  } else {
    dashboardStatus.classList.add(
      'iot-status-error'
    );
  }


  /*
   * Preserve the status dot <span>.
   */
  const textNodes =
    Array.from(
      dashboardStatus.childNodes
    ).filter(
      (node) =>
        node.nodeType ===
        Node.TEXT_NODE
    );

  if (
    textNodes.length > 0
  ) {
    textNodes[
      textNodes.length - 1
    ].textContent =
      ` ${text}`;
  } else {
    dashboardStatus.append(
      ` ${text}`
    );
  }
}


/* ============================================================
   SUMMARY
   ============================================================ */

function calculateAlertSummary() {
  const unresolved =
    persistentAlerts.filter(
      isUnresolvedAlert
    );


  const critical =
    unresolved.filter(
      (alert) =>
        isCriticalSeverity(
          alert.severity
        )
    ).length;


  const warning =
    unresolved.length -
    critical;


  alertSummary = {
    unresolved:
      unresolved.length,

    critical,

    warning,
  };
}


function renderSummary() {
  stationCount.textContent =
    dashboardSummary
      .total_stations ?? 0;

  onlineCount.textContent =
    dashboardSummary
      .online_stations ?? 0;

  offlineCount.textContent =
    dashboardSummary
      .offline_stations ?? 0;

  activeAlertCount.textContent =
    alertSummary
      .unresolved ?? 0;

  criticalCount.textContent =
    alertSummary
      .critical ?? 0;

  warningCount.textContent =
    alertSummary
      .warning ?? 0;
}


/* ============================================================
   STATION SELECTOR
   ============================================================ */

function renderStationOptions() {
  const previous =
    selectedStation ||
    stationFilter.value;


  const stationIds = [
    ...new Set(
      latestReadings
        .map(
          (reading) =>
            reading.station_id
        )
        .filter(Boolean)
    ),
  ].sort();


  stationFilter.replaceChildren();


  if (
    stationIds.length === 0
  ) {
    const option =
      document.createElement(
        'option'
      );

    option.value = '';

    option.textContent =
      'No live station data';

    stationFilter.appendChild(
      option
    );

    selectedStation = '';

    return;
  }


  for (
    const stationId of
    stationIds
  ) {
    const option =
      document.createElement(
        'option'
      );

    option.value =
      stationId;

    option.textContent =
      stationId;

    stationFilter.appendChild(
      option
    );
  }


  if (
    previous &&
    stationIds.includes(
      previous
    )
  ) {
    selectedStation =
      previous;
  } else {
    selectedStation =
      stationIds[0];
  }


  stationFilter.value =
    selectedStation;
}


/* ============================================================
   LIVE SENSOR ALERT HELPERS
   ============================================================ */

function findLiveAlert(
  stationId,
  type
) {
  return liveActiveAlerts.find(
    (alert) =>
      alert.station_id ===
        stationId &&
      alert.type === type &&
      alert.status ===
        'active'
  );
}


function setSensorCardState(
  element,
  state
) {
  const card =
    element.closest(
      '.iot-sensor-card'
    );

  if (!card) {
    return;
  }


  card.classList.remove(
    'iot-sensor-normal',
    'iot-sensor-warning',
    'iot-sensor-critical',
    'iot-sensor-unavailable'
  );


  if (state) {
    card.classList.add(
      `iot-sensor-${state}`
    );
  }
}


/* ============================================================
   SENSOR DISPLAY
   ============================================================ */

function clearSensorDisplay() {
  selectedStationId.textContent =
    '–';

  stationLastSeen.textContent =
    '–';

  stationSequence.textContent =
    '–';


  sensorTemperature.textContent =
    '–';

  sensorHumidity.textContent =
    '–';

  sensorSoil.textContent =
    '–';

  sensorMotion.textContent =
    '–';

  sensorDistance.textContent =
    '–';

  sensorRain.textContent =
    '–';


  temperatureStatus.textContent =
    'Waiting for reading';

  humidityStatus.textContent =
    'Waiting for reading';

  soilStatus.textContent =
    'Waiting for reading';

  motionStatus.textContent =
    'Waiting for reading';

  distanceStatus.textContent =
    'Waiting for reading';

  rainStatus.textContent =
    'Waiting for reading';


  [
    sensorTemperature,
    sensorHumidity,
    sensorSoil,
    sensorMotion,
    sensorDistance,
    sensorRain,
  ].forEach(
    (element) => {
      setSensorCardState(
        element,
        'unavailable'
      );
    }
  );
}


function renderSelectedStation() {
  if (!selectedStation) {
    clearSensorDisplay();

    return;
  }


  const reading =
    latestReadings.find(
      (item) =>
        item.station_id ===
        selectedStation
    );


  if (!reading) {
    clearSensorDisplay();

    return;
  }


  selectedStationId.textContent =
    isReadingOnline(reading)
      ? `${reading.station_id} · Online`
      : `${reading.station_id} · Offline`;


  stationLastSeen.textContent =
    formatTime(
      getReadingTime(
        reading
      )
    );


  stationSequence.textContent =
    Number.isFinite(
      Number(
        reading.sequence
      )
    )
      ? String(
          reading.sequence
        )
      : '–';


  /* --------------------------------------------------------
     TEMPERATURE
     -------------------------------------------------------- */

  if (
    reading.dht_valid ===
    false
  ) {
    sensorTemperature.textContent =
      '–';

    temperatureStatus.textContent =
      'DHT sensor unavailable';

    setSensorCardState(
      sensorTemperature,
      'unavailable'
    );
  } else {
    sensorTemperature.textContent =
      formatNumber(
        reading.temperature_c
      );


    const alert =
      findLiveAlert(
        selectedStation,
        'high_temperature'
      );


    if (alert) {
      temperatureStatus.textContent =
        'High temperature alert';

      setSensorCardState(
        sensorTemperature,
        isCriticalSeverity(
          alert.severity
        )
          ? 'critical'
          : 'warning'
      );
    } else {
      temperatureStatus.textContent =
        'No active temperature alert';

      setSensorCardState(
        sensorTemperature,
        'normal'
      );
    }
  }


  /* --------------------------------------------------------
     HUMIDITY

     Live humidity is displayed, but the current in-memory
     threat detector has no humidity threshold.
     -------------------------------------------------------- */

  if (
    reading.dht_valid ===
    false
  ) {
    sensorHumidity.textContent =
      '–';

    humidityStatus.textContent =
      'DHT sensor unavailable';

    setSensorCardState(
      sensorHumidity,
      'unavailable'
    );
  } else {
    sensorHumidity.textContent =
      formatNumber(
        getHumidity(
          reading
        )
      );

    humidityStatus.textContent =
      'Environmental monitoring';

    setSensorCardState(
      sensorHumidity,
      'normal'
    );
  }


  /* --------------------------------------------------------
     SOIL MOISTURE
     -------------------------------------------------------- */

  sensorSoil.textContent =
    formatNumber(
      reading
        .soil_moisture_pct
    );


  const soilAlert =
    findLiveAlert(
      selectedStation,
      'low_soil_moisture'
    );


  if (soilAlert) {
    soilStatus.textContent =
      'Low soil moisture alert';

    setSensorCardState(
      sensorSoil,
      isCriticalSeverity(
        soilAlert.severity
      )
        ? 'critical'
        : 'warning'
    );
  } else {
    soilStatus.textContent =
      'No active soil alert';

    setSensorCardState(
      sensorSoil,
      'normal'
    );
  }


  /* --------------------------------------------------------
     MOTION
     -------------------------------------------------------- */

  const motion =
    getMotion(reading);


  sensorMotion.textContent =
    motion === true
      ? 'Detected'
      : motion === false
        ? 'Clear'
        : '–';


  const motionAlert =
    findLiveAlert(
      selectedStation,
      'motion_detected'
    );


  if (motionAlert) {
    motionStatus.textContent =
      'Movement detected near station';

    setSensorCardState(
      sensorMotion,
      isCriticalSeverity(
        motionAlert.severity
      )
        ? 'critical'
        : 'warning'
    );
  } else if (
    typeof motion ===
    'boolean'
  ) {
    motionStatus.textContent =
      'No active movement alert';

    setSensorCardState(
      sensorMotion,
      'normal'
    );
  } else {
    motionStatus.textContent =
      'Motion sensor unavailable';

    setSensorCardState(
      sensorMotion,
      'unavailable'
    );
  }


  /* --------------------------------------------------------
     PROXIMITY
     -------------------------------------------------------- */

  if (
    reading.distance_valid ===
    false
  ) {
    sensorDistance.textContent =
      '–';

    distanceStatus.textContent =
      'Distance sensor unavailable';

    setSensorCardState(
      sensorDistance,
      'unavailable'
    );
  } else {
    sensorDistance.textContent =
      formatNumber(
        reading.distance_cm
      );


    const proximityAlert =
      findLiveAlert(
        selectedStation,
        'proximity_breach'
      );


    if (proximityAlert) {
      distanceStatus.textContent =
        'Object inside protection zone';

      setSensorCardState(
        sensorDistance,
        'critical'
      );
    } else {
      distanceStatus.textContent =
        'Protection zone clear';

      setSensorCardState(
        sensorDistance,
        'normal'
      );
    }
  }


  /* --------------------------------------------------------
     RAIN
     -------------------------------------------------------- */

  sensorRain.textContent =
    formatNumber(
      reading
        .rain_intensity_pct
    );


  const rainAlert =
    findLiveAlert(
      selectedStation,
      'heavy_rain'
    );


  if (rainAlert) {
    rainStatus.textContent =
      'Heavy rainfall alert';

    setSensorCardState(
      sensorRain,
      isCriticalSeverity(
        rainAlert.severity
      )
        ? 'critical'
        : 'warning'
    );
  } else {
    rainStatus.textContent =
      'No active rain alert';

    setSensorCardState(
      sensorRain,
      'normal'
    );
  }
}


/* ============================================================
   TELEMETRY TABLE
   ============================================================ */

function renderTelemetry() {
  telemetryBody.replaceChildren();


  if (!selectedStation) {
    telemetryMessage.textContent =
      'No live monitoring station is currently available.';


    const row =
      document.createElement(
        'tr'
      );

    const cell =
      createCell(
        'No live telemetry available.'
      );

    cell.colSpan = 8;

    cell.className =
      'iot-empty-cell';

    row.appendChild(cell);

    telemetryBody.appendChild(
      row
    );

    return;
  }


  const readings =
    recentReadings.filter(
      (reading) =>
        reading.station_id ===
        selectedStation
    );


  if (
    readings.length === 0
  ) {
    telemetryMessage.textContent =
      `No recent telemetry for ${selectedStation}.`;


    const row =
      document.createElement(
        'tr'
      );

    const cell =
      createCell(
        'No recent telemetry.'
      );

    cell.colSpan = 8;

    cell.className =
      'iot-empty-cell';

    row.appendChild(cell);

    telemetryBody.appendChild(
      row
    );

    return;
  }


  const visible =
    readings.slice(
      0,
      20
    );


  telemetryMessage.textContent =
    `Showing ${visible.length} recent readings from ${selectedStation}.`;


  for (
    const reading of
    visible
  ) {
    const row =
      document.createElement(
        'tr'
      );


    row.appendChild(
      createCell(
        formatShortTime(
          getReadingTime(
            reading
          )
        )
      )
    );


    row.appendChild(
      createCell(
        reading.dht_valid ===
          false
          ? 'Invalid'
          : `${formatNumber(
              reading.temperature_c
            )} °C`
      )
    );


    row.appendChild(
      createCell(
        reading.dht_valid ===
          false
          ? 'Invalid'
          : `${formatNumber(
              getHumidity(
                reading
              )
            )} %`
      )
    );


    row.appendChild(
      createCell(
        `${formatNumber(
          reading
            .soil_moisture_pct
        )} %`
      )
    );


    const motion =
      getMotion(reading);


    row.appendChild(
      createCell(
        motion === true
          ? 'Detected'
          : motion === false
            ? 'Clear'
            : '–'
      )
    );


    row.appendChild(
      createCell(
        reading.distance_valid ===
          false
          ? 'Invalid'
          : `${formatNumber(
              reading.distance_cm
            )} cm`
      )
    );


    row.appendChild(
      createCell(
        `${formatNumber(
          reading
            .rain_intensity_pct
        )} %`
      )
    );


    row.appendChild(
      createCell(
        Number.isFinite(
          Number(
            reading.sequence
          )
        )
          ? String(
              reading.sequence
            )
          : '–'
      )
    );


    telemetryBody.appendChild(
      row
    );
  }
}


/* ============================================================
   PERSISTENT ALERT DISPLAY
   ============================================================ */

function addAlertDetail(
  parent,
  label,
  value
) {
  const row =
    document.createElement(
      'p'
    );

  row.className =
    'iot-alert-detail';


  const title =
    document.createElement(
      'span'
    );

  title.textContent =
    `${label}: `;


  const content =
    document.createElement(
      'strong'
    );

  content.textContent =
    value;


  row.appendChild(title);

  row.appendChild(content);

  parent.appendChild(row);
}


function createAlertStatusPill(
  status
) {
  const pill =
    document.createElement(
      'span'
    );

  pill.className =
    'pill';


  if (status === 'open') {
    pill.classList.add('e');

    pill.textContent =
      'Open';
  } else if (
    status === 'acknowledged'
  ) {
    pill.classList.add('w');

    pill.textContent =
      'Acknowledged';
  } else {
    pill.textContent =
      'Resolved';
  }


  return pill;
}


function createAlertActionButton(
  label,
  className,
  action
) {
  const button =
    document.createElement(
      'button'
    );

  button.type =
    'button';

  button.className =
    className;

  button.textContent =
    label;

  button.addEventListener(
    'click',
    action
  );

  return button;
}


async function performAlertAction(
  alert,
  action,
  notes = ''
) {
  if (
    alertActionsInProgress.has(
      alert.id
    )
  ) {
    return;
  }


  alertActionsInProgress.add(
    alert.id
  );

  renderAlerts();


  try {
    const token =
      await getAccessToken();


    const options = {
      method: 'PATCH',
      body:
        action === 'resolve'
          ? {
              resolution_notes:
                notes.trim(),
            }
          : {},
    };


    await requestIoT(
      `/alerts/${encodeURIComponent(
        alert.id
      )}/${action}`,
      token,
      options
    );


    if (
      action === 'resolve'
    ) {
      resolutionDrafts.delete(
        alert.id
      );

      notify(
        'Alert resolved successfully.'
      );
    } else {
      notify(
        'Alert acknowledged successfully.'
      );
    }


    await loadDashboard({
      silent: true,
    });

  } catch (error) {
    console.error(
      'IoT alert action failed:',
      error
    );


    notify(
      error instanceof Error
        ? error.message
        : 'Alert action failed.'
    );

  } finally {
    alertActionsInProgress.delete(
      alert.id
    );

    renderAlerts();
  }
}


function renderPersistentAlertCard(
  alert
) {
  const status =
    normalisePersistentStatus(
      alert.alert_status
    );


  const busy =
    alertActionsInProgress.has(
      alert.id
    );


  const card =
    document.createElement(
      'article'
    );

  card.className =
    'card iot-alert-card';


  if (
    isCriticalSeverity(
      alert.severity
    )
  ) {
    card.classList.add(
      'iot-alert-critical'
    );
  } else {
    card.classList.add(
      'iot-alert-warning'
    );
  }


  /* Heading */

  const heading =
    document.createElement(
      'div'
    );

  heading.className =
    'iot-alert-heading';


  const titleArea =
    document.createElement(
      'div'
    );


  const title =
    document.createElement(
      'h3'
    );

  title.textContent =
    alert.alert_message ||
    'IoT threat alert';


  const station =
    document.createElement(
      'span'
    );

  station.className =
    'iot-alert-station';

  station.textContent =
    alert.station_id
      ? `Station ${alert.station_id}`
      : 'Unknown station';


  titleArea.appendChild(
    title
  );

  titleArea.appendChild(
    station
  );


  const severity =
    document.createElement(
      'span'
    );

  severity.className =
    isCriticalSeverity(
      alert.severity
    )
      ? 'pill e'
      : 'pill w';

  severity.textContent =
    capitalise(
      alert.severity
    );


  heading.appendChild(
    titleArea
  );

  heading.appendChild(
    severity
  );

  card.appendChild(
    heading
  );


  /* Status */

  const statusRow =
    document.createElement(
      'div'
    );

  statusRow.className =
    'iot-alert-status-row';

  statusRow.appendChild(
    createAlertStatusPill(
      status
    )
  );

  card.appendChild(
    statusRow
  );


  addAlertDetail(
    card,
    'Triggered',
    formatTime(
      alert.triggered_at
    )
  );


  if (
    alert.reading_id
  ) {
    addAlertDetail(
      card,
      'Reading ID',
      alert.reading_id
    );
  }


  if (
    status ===
      'acknowledged' ||
    status ===
      'resolved'
  ) {
    addAlertDetail(
      card,
      'Acknowledged',
      formatTime(
        alert.acknowledged_at
      )
    );
  }


  if (
    status === 'resolved'
  ) {
    addAlertDetail(
      card,
      'Resolved',
      formatTime(
        alert.resolved_at
      )
    );


    if (
      alert.resolution_notes
    ) {
      addAlertDetail(
        card,
        'Resolution',
        alert.resolution_notes
      );
    }
  }


  /* --------------------------------------------------------
     OPEN -> ACKNOWLEDGE
     -------------------------------------------------------- */

  if (
    status === 'open'
  ) {
    const actions =
      document.createElement(
        'div'
      );

    actions.className =
      'iot-alert-actions';


    const acknowledgeButton =
      createAlertActionButton(
        busy
          ? 'Working...'
          : 'Acknowledge',
        'btn small',
        () => {
          void performAlertAction(
            alert,
            'acknowledge'
          );
        }
      );


    acknowledgeButton.disabled =
      busy;


    actions.appendChild(
      acknowledgeButton
    );

    card.appendChild(
      actions
    );
  }


  /* --------------------------------------------------------
     ACKNOWLEDGED -> RESOLVE
     -------------------------------------------------------- */

  if (
    status ===
    'acknowledged'
  ) {
    const resolveBox =
      document.createElement(
        'div'
      );

    resolveBox.className =
      'iot-resolution-box';


    const label =
      document.createElement(
        'label'
      );

    label.className =
      'iot-resolution-label';

    label.textContent =
      'Resolution notes';


    const textarea =
      document.createElement(
        'textarea'
      );

    textarea.className =
      'iot-resolution-input';

    textarea.rows = 3;

    textarea.maxLength =
      2000;

    textarea.placeholder =
      'Optional notes about how the threat was investigated or resolved.';

    textarea.value =
      resolutionDrafts.get(
        alert.id
      ) || '';


    textarea.disabled =
      busy;


    textarea.addEventListener(
      'input',
      () => {
        resolutionDrafts.set(
          alert.id,
          textarea.value
        );
      }
    );


    const actions =
      document.createElement(
        'div'
      );

    actions.className =
      'iot-alert-actions';


    const resolveButton =
      createAlertActionButton(
        busy
          ? 'Working...'
          : 'Resolve alert',
        'btn small',
        () => {
          void performAlertAction(
            alert,
            'resolve',
            textarea.value
          );
        }
      );


    resolveButton.disabled =
      busy;


    label.appendChild(
      textarea
    );

    resolveBox.appendChild(
      label
    );

    actions.appendChild(
      resolveButton
    );

    resolveBox.appendChild(
      actions
    );

    card.appendChild(
      resolveBox
    );
  }


  return card;
}


function getFilteredPersistentAlerts() {
  const filter =
    alertFilter.value;


  if (filter === 'all') {
    return persistentAlerts;
  }


  return persistentAlerts.filter(
    (alert) =>
      normalisePersistentStatus(
        alert.alert_status
      ) === filter
  );
}


function renderAlerts() {
  alertList.replaceChildren();

  calculateAlertSummary();

  renderSummary();


  const alerts =
    getFilteredPersistentAlerts();


  if (
    alerts.length === 0
  ) {
    const filter =
      alertFilter.value;


    alertMessage.textContent =
      filter === 'open'
        ? 'No open alerts require attention.'
        : `No ${filter} alerts to display.`;


    const empty =
      document.createElement(
        'div'
      );

    empty.className =
      'card iot-empty-alert';


    const title =
      document.createElement(
        'strong'
      );

    title.textContent =
      filter === 'open'
        ? 'No open threats'
        : 'No alerts';


    const text =
      document.createElement(
        'p'
      );

    text.textContent =
      filter === 'open'
        ? 'No persistent IoT alert currently requires acknowledgement.'
        : 'There are no alerts in this category.';


    empty.appendChild(
      title
    );

    empty.appendChild(
      text
    );

    alertList.appendChild(
      empty
    );

    return;
  }


  alertMessage.textContent =
    `Showing ${alerts.length} ${
      alertFilter.value ===
      'all'
        ? ''
        : `${alertFilter.value} `
    }alerts.`;


  for (
    const alert of
    alerts
  ) {
    alertList.appendChild(
      renderPersistentAlertCard(
        alert
      )
    );
  }
}


/* ============================================================
   COMPLETE RENDER
   ============================================================ */

function renderDashboard() {
  calculateAlertSummary();

  renderSummary();

  renderStationOptions();

  renderSelectedStation();

  renderTelemetry();

  renderAlerts();
}


/* ============================================================
   RESET
   ============================================================ */

function resetDashboard(
  message
) {
  latestReadings = [];

  recentReadings = [];

  persistentAlerts = [];

  liveActiveAlerts = [];

  selectedStation = '';


  dashboardSummary = {
    total_stations: 0,
    online_stations: 0,
    offline_stations: 0,
  };


  alertSummary = {
    unresolved: 0,
    critical: 0,
    warning: 0,
  };


  renderSummary();

  renderStationOptions();

  clearSensorDisplay();


  telemetryBody.replaceChildren();


  const telemetryRow =
    document.createElement(
      'tr'
    );

  const telemetryCell =
    createCell(message);

  telemetryCell.colSpan = 8;

  telemetryCell.className =
    'iot-empty-cell';

  telemetryRow.appendChild(
    telemetryCell
  );

  telemetryBody.appendChild(
    telemetryRow
  );


  telemetryMessage.textContent =
    message;


  alertList.replaceChildren();

  alertMessage.textContent =
    message;


  const alertCard =
    document.createElement(
      'div'
    );

  alertCard.className =
    'card iot-empty-alert';

  alertCard.textContent =
    message;

  alertList.appendChild(
    alertCard
  );
}


/* ============================================================
   LOAD DASHBOARD
   ============================================================ */

async function loadDashboard({
  silent = false,
} = {}) {

  /*
   * Do not interrupt alert actions.
   *
   * Dashboard refresh requests may cancel older dashboard
   * refresh requests, but never PATCH alert operations.
   */
  if (currentRequest) {
    currentRequest.abort();
  }


  const controller =
    new AbortController();

  currentRequest =
    controller;


  if (!silent) {
    refreshButton.disabled =
      true;

    setDashboardStatus(
      'loading',
      'Refreshing'
    );
  }


  try {
    const token =
      await getAccessToken();


    /*
     * Persistent and live data are loaded together.
     */
    const [
      registeredSummaryResult,
      liveSummaryResult,
      latestResult,
      readingsResult,
      persistentAlertsResult,
      liveAlertsResult,
    ] =
      await Promise.all([

        /*
         * Registered stations in Supabase.
         */
        requestIoT(
          '/summary',
          token,
          {
            signal:
              controller.signal,
          }
        ),


        /*
         * Current MQTT station activity.
         */
        requestIoT(
          '/summary/live',
          token,
          {
            signal:
              controller.signal,
          }
        ),


        /*
         * Latest live reading per station.
         */
        requestIoT(
          '/latest',
          token,
          {
            signal:
              controller.signal,
          }
        ),


        /*
         * Recent live MQTT telemetry.
         */
        requestIoT(
          '/readings?limit=100',
          token,
          {
            signal:
              controller.signal,
          }
        ),


        /*
         * Persistent Supabase alert history.
         */
        requestIoT(
          '/alerts',
          token,
          {
            signal:
              controller.signal,
          }
        ),


        /*
         * Current live threat state for sensor cards.
         */
        requestIoT(
          '/alerts/live?status=active&limit=100',
          token,
          {
            signal:
              controller.signal,
          }
        ),
      ]);


    if (
      controller.signal.aborted
    ) {
      return;
    }


    /* --------------------------------------------------------
       STATION SUMMARY
       -------------------------------------------------------- */

    const registeredSummary =
      registeredSummaryResult.data ||
      {};


    const liveSummary =
      liveSummaryResult.data ||
      {};


    const totalStations =
      Math.max(
        0,
        Number(
          registeredSummary
            .total_stations
        ) || 0
      );


    /*
     * A station counts as online when the live backend
     * considers it active within the 60-second window.
     *
     * Do not allow Online to exceed registered stations.
     */
    const onlineStations =
      Math.min(
        totalStations,
        Math.max(
          0,
          Number(
            liveSummary
              .online_stations
          ) || 0
        )
      );


    dashboardSummary = {
      total_stations:
        totalStations,

      online_stations:
        onlineStations,

      offline_stations:
        Math.max(
          0,
          totalStations -
            onlineStations
        ),
    };


    /* --------------------------------------------------------
       LIVE TELEMETRY
       -------------------------------------------------------- */

    latestReadings =
      Array.isArray(
        latestResult.data
      )
        ? latestResult.data
        : [];


    recentReadings =
      Array.isArray(
        readingsResult.data
      )
        ? readingsResult.data
        : [];


    /* --------------------------------------------------------
       PERSISTENT ALERTS
       -------------------------------------------------------- */

    persistentAlerts =
      Array.isArray(
        persistentAlertsResult.data
      )
        ? persistentAlertsResult.data
        : [];


    /*
     * Newest first.
     */
    persistentAlerts.sort(
      (a, b) =>
        new Date(
          b.triggered_at || 0
        ).getTime() -
        new Date(
          a.triggered_at || 0
        ).getTime()
    );


    /* --------------------------------------------------------
       LIVE ALERTS
       -------------------------------------------------------- */

    liveActiveAlerts =
      Array.isArray(
        liveAlertsResult.data
      )
        ? liveAlertsResult.data
        : [];


    renderDashboard();


    const now =
      new Date();


    lastUpdated.textContent =
      `Last updated ${now.toLocaleTimeString(
        'en-MY'
      )}`;


    setDashboardStatus(
      'live',
      'Backend connected'
    );

  } catch (error) {

    if (
      controller.signal.aborted
    ) {
      return;
    }


    console.error(
      'IoT dashboard error:',
      error
    );


    const message =
      error instanceof Error
        ? error.message
        : 'Unable to load IoT monitoring data.';


    resetDashboard(
      message
    );


    setDashboardStatus(
      'error',
      'Connection problem'
    );


    lastUpdated.textContent =
      'Unable to update dashboard';

  } finally {

    if (
      currentRequest ===
      controller
    ) {
      currentRequest = null;

      refreshButton.disabled =
        false;
    }
  }
}


/* ============================================================
   EVENTS
   ============================================================ */

refreshButton.addEventListener(
  'click',
  () => {
    void loadDashboard();
  }
);


stationFilter.addEventListener(
  'change',
  () => {
    selectedStation =
      stationFilter.value;

    renderSelectedStation();

    renderTelemetry();
  }
);


alertFilter.addEventListener(
  'change',
  () => {
    renderAlerts();
  }
);


/* ============================================================
   AUTO REFRESH
   ============================================================ */

function startAutoRefresh() {
  if (refreshTimer) {
    clearInterval(
      refreshTimer
    );
  }


  refreshTimer =
    setInterval(
      () => {

        /*
         * Do not poll while the tab is hidden.
         */
        if (
          document.hidden
        ) {
          return;
        }


        void loadDashboard({
          silent: true,
        });

      },
      AUTO_REFRESH_MS
    );
}


document.addEventListener(
  'visibilitychange',
  () => {
    if (
      !document.hidden
    ) {
      void loadDashboard({
        silent: true,
      });
    }
  }
);


/* ============================================================
   INITIAL LOAD
   ============================================================ */

clearSensorDisplay();

void loadDashboard();

startAutoRefresh();