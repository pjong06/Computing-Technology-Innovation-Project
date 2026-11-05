drawMenu('alerts.html');

/*
 * ============================================================
 * NIAH BIOTRACK - IOT MONITORING DASHBOARD
 * ============================================================
 *
 * Existing backend endpoints used:
 *
 * GET /api/iot/summary/live
 * GET /api/iot/latest
 * GET /api/iot/readings
 * GET /api/iot/alerts/live
 *
 * All endpoints are protected by:
 *
 * requireAuth
 * requireRole('officer')
 *
 * The officer access token comes from shared.js.
 * ============================================================
 */


/* ============================================================
   DOM REFERENCES
   ============================================================ */

const refreshButton =
  document.getElementById('refresh-dashboard');

const dashboardStatus =
  document.getElementById('dashboard-status');

const lastUpdated =
  document.getElementById('last-updated');

const stationFilter =
  document.getElementById('station-filter');


/* Summary */

const stationCount =
  document.getElementById('station-count');

const onlineCount =
  document.getElementById('online-count');

const offlineCount =
  document.getElementById('offline-count');

const activeAlertCount =
  document.getElementById('active-alert-count');


/* Selected station */

const selectedStationId =
  document.getElementById('selected-station-id');

const stationLastSeen =
  document.getElementById('station-last-seen');

const stationSequence =
  document.getElementById('station-sequence');


/* Sensors */

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


/* Sensor status text */

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


/* Telemetry */

const telemetryMessage =
  document.getElementById('telemetry-message');

const telemetryBody =
  document.getElementById('telemetry-body');


/* Alerts */

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

let latestReadings = [];

let recentReadings = [];

let currentAlerts = [];

let activeAlerts = [];

let dashboardSummary = {
  total_stations: 0,
  online_stations: 0,
  offline_stations: 0,
};

let alertSummary = {
  active: 0,
  critical: 0,
  warning: 0,
};

let selectedStation = '';

let currentRequest = null;

let refreshTimer = null;


/*
 * Dashboard should update fast enough to satisfy the project
 * requirement for near-real-time monitoring.
 */
const AUTO_REFRESH_MS = 5000;


/*
 * Backend currently considers a station online if its latest
 * in-memory reading was received within 60 seconds.
 */
const ONLINE_WINDOW_MS = 60 * 1000;


/* ============================================================
   THREAT DISPLAY NAMES
   ============================================================ */

const threatNames = {
  high_temperature:
    'High temperature',

  low_soil_moisture:
    'Low soil moisture',

  motion_detected:
    'Motion detected',

  proximity_breach:
    'Proximity breach',

  heavy_rain:
    'Heavy rain',
};


const sensorUnits = {
  temperature_c:
    '°C',

  soil_moisture_pct:
    '%',

  distance_cm:
    ' cm',

  rain_intensity_pct:
    '%',
};


/* ============================================================
   GENERAL HELPERS
   ============================================================ */

function formatNumber(
  value,
  digits = 1
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return '–';
  }

  return number.toFixed(
    digits
  );
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
      dateStyle:
        'medium',

      timeStyle:
        'medium',
    }
  );
}


function formatShortTime(
  value
) {
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
      hour:
        '2-digit',

      minute:
        '2-digit',

      second:
        '2-digit',
    }
  );
}


function isReadingOnline(
  reading
) {
  if (
    !reading ||
    !reading.received_at
  ) {
    return false;
  }

  const time =
    new Date(
      reading.received_at
    ).getTime();

  if (
    Number.isNaN(time)
  ) {
    return false;
  }

  return (
    Date.now() - time <=
    ONLINE_WINDOW_MS
  );
}


/*
 * Support both live MQTT field names and the persisted
 * Supabase field names.
 */
function getHumidity(
  reading
) {
  return (
    reading?.humidity_pct ??
    reading?.humidity_percent
  );
}


function getMotion(
  reading
) {
  return (
    reading?.motion_detected ??
    reading?.movement_detected
  );
}


function getReadingTime(
  reading
) {
  return (
    reading?.received_at ??
    reading?.recorded_at
  );
}


/* ============================================================
   OFFICER AUTHENTICATION
   ============================================================ */

async function getAccessToken() {
  if (
    typeof window
      .getOfficerAccessToken !==
    'function'
  ) {
    throw new Error(
      'Officer authentication is not connected.'
    );
  }

  const token =
    await window
      .getOfficerAccessToken();

  if (!token) {
    throw new Error(
      'Sign in as a Conservation Officer to view IoT monitoring.'
    );
  }

  return token;
}


/* ============================================================
   API REQUEST
   ============================================================ */

async function fetchIoT(
  path,
  token,
  signal
) {
  const response =
    await fetch(
      `/api/iot${path}`,
      {
        method:
          'GET',

        headers: {
          Authorization:
            `Bearer ${token}`,
        },

        cache:
          'no-store',

        signal,
      }
    );

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
      'The IoT dashboard is available to Conservation Officers only.'
    );
  }

  if (!response.ok) {
    throw new Error(
      `IoT API request failed (${response.status}).`
    );
  }

  return response.json();
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

  if (
    state === 'live'
  ) {
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

  dashboardStatus.lastChild.textContent =
    ` ${text}`;
}


/* ============================================================
   SUMMARY
   ============================================================ */

function renderSummary() {
  stationCount.textContent =
    dashboardSummary
      .total_stations ??
    0;

  onlineCount.textContent =
    dashboardSummary
      .online_stations ??
    0;

  offlineCount.textContent =
    dashboardSummary
      .offline_stations ??
    0;

  activeAlertCount.textContent =
    alertSummary.active ??
    0;

  criticalCount.textContent =
    alertSummary.critical ??
    0;

  warningCount.textContent =
    alertSummary.warning ??
    0;
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
   ACTIVE ALERT LOOKUP
   ============================================================ */

function findActiveAlert(
  stationId,
  type
) {
  return activeAlerts.find(
    (alert) =>
      alert.station_id ===
        stationId &&
      alert.type === type &&
      alert.status ===
        'active'
  );
}


/* ============================================================
   SENSOR CARD STYLING
   ============================================================ */

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
   LIVE SENSOR DISPLAY
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
    (element) =>
      setSensorCardState(
        element,
        'unavailable'
      )
  );
}


function renderSelectedStation() {
  if (
    !selectedStation
  ) {
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
    reading.station_id;

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


  /*
   * ======================================================
   * TEMPERATURE
   * ======================================================
   */

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
      findActiveAlert(
        selectedStation,
        'high_temperature'
      );

    if (alert) {
      temperatureStatus.textContent =
        'High temperature alert';

      setSensorCardState(
        sensorTemperature,
        alert.severity ===
          'critical'
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


  /*
   * ======================================================
   * HUMIDITY
   *
   * Current backend does not define a humidity threat rule.
   * The dashboard therefore reports the real value without
   * inventing a threshold.
   * ======================================================
   */

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


  /*
   * ======================================================
   * SOIL MOISTURE
   * ======================================================
   */

  sensorSoil.textContent =
    formatNumber(
      reading
        .soil_moisture_pct
    );

  const soilAlert =
    findActiveAlert(
      selectedStation,
      'low_soil_moisture'
    );

  if (soilAlert) {
    soilStatus.textContent =
      'Low soil moisture alert';

    setSensorCardState(
      sensorSoil,
      soilAlert.severity ===
        'critical'
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


  /*
   * ======================================================
   * MOTION
   * ======================================================
   */

  const motion =
    getMotion(
      reading
    );

  sensorMotion.textContent =
    motion === true
      ? 'Detected'
      : motion === false
        ? 'Clear'
        : '–';

  const motionAlert =
    findActiveAlert(
      selectedStation,
      'motion_detected'
    );

  if (motionAlert) {
    motionStatus.textContent =
      'Movement detected near station';

    setSensorCardState(
      sensorMotion,
      motionAlert.severity ===
        'critical'
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


  /*
   * ======================================================
   * DISTANCE / PROXIMITY
   * ======================================================
   */

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

    const distanceAlert =
      findActiveAlert(
        selectedStation,
        'proximity_breach'
      );

    if (distanceAlert) {
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


  /*
   * ======================================================
   * RAIN
   * ======================================================
   */

  sensorRain.textContent =
    formatNumber(
      reading
        .rain_intensity_pct
    );

  const rainAlert =
    findActiveAlert(
      selectedStation,
      'heavy_rain'
    );

  if (rainAlert) {
    rainStatus.textContent =
      'Heavy rainfall alert';

    setSensorCardState(
      sensorRain,
      rainAlert.severity ===
        'critical'
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


  /*
   * Station state.
   */

  if (
    isReadingOnline(
      reading
    )
  ) {
    selectedStationId.textContent =
      `${reading.station_id} · Online`;
  } else {
    selectedStationId.textContent =
      `${reading.station_id} · Offline`;
  }
}


/* ============================================================
   TELEMETRY TABLE
   ============================================================ */

function makeCell(text) {
  const td =
    document.createElement(
      'td'
    );

  td.textContent =
    text;

  return td;
}


function renderTelemetry() {
  telemetryBody.replaceChildren();

  if (
    !selectedStation
  ) {
    telemetryMessage.textContent =
      'No monitoring station is currently available.';

    const row =
      document.createElement(
        'tr'
      );

    const cell =
      makeCell(
        'No telemetry available.'
      );

    cell.colSpan = 8;

    cell.className =
      'iot-empty-cell';

    row.appendChild(
      cell
    );

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
      makeCell(
        'No recent telemetry.'
      );

    cell.colSpan = 8;

    cell.className =
      'iot-empty-cell';

    row.appendChild(
      cell
    );

    telemetryBody.appendChild(
      row
    );

    return;
  }

  telemetryMessage.textContent =
    `Showing ${readings.length} recent readings from ${selectedStation}.`;


  /*
   * Limit visual table size.
   * Backend itself still keeps more recent readings.
   */
  const visible =
    readings.slice(
      0,
      20
    );


  for (
    const reading of
    visible
  ) {
    const row =
      document.createElement(
        'tr'
      );


    row.appendChild(
      makeCell(
        formatShortTime(
          getReadingTime(
            reading
          )
        )
      )
    );


    row.appendChild(
      makeCell(
        reading.dht_valid ===
          false
          ? 'Invalid'
          : `${formatNumber(
              reading.temperature_c
            )} °C`
      )
    );


    row.appendChild(
      makeCell(
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
      makeCell(
        `${formatNumber(
          reading
            .soil_moisture_pct
        )} %`
      )
    );


    const motion =
      getMotion(
        reading
      );

    row.appendChild(
      makeCell(
        motion === true
          ? 'Detected'
          : motion === false
            ? 'Clear'
            : '–'
      )
    );


    row.appendChild(
      makeCell(
        reading.distance_valid ===
          false
          ? 'Invalid'
          : `${formatNumber(
              reading.distance_cm
            )} cm`
      )
    );


    row.appendChild(
      makeCell(
        `${formatNumber(
          reading
            .rain_intensity_pct
        )} %`
      )
    );


    row.appendChild(
      makeCell(
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
   ALERT DISPLAY
   ============================================================ */

function formatAlertReading(
  alert
) {
  if (
    alert.sensor ===
    'motion_detected'
  ) {
    return 'PIR motion detected';
  }

  const unit =
    sensorUnits[
      alert.sensor
    ] || '';

  const value =
    `${alert.value}${unit}`;

  const threshold =
    alert.threshold ===
    null ||
    alert.threshold ===
    undefined
      ? 'Not applicable'
      : `${alert.threshold}${unit}`;

  return (
    `Reading: ${value} · ` +
    `Threshold: ${threshold}`
  );
}


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

  row.appendChild(
    title
  );

  row.appendChild(
    content
  );

  parent.appendChild(
    row
  );
}


function renderAlertCard(
  alert
) {
  const card =
    document.createElement(
      'article'
    );

  card.className =
    'card iot-alert-card';

  if (
    alert.severity ===
    'critical'
  ) {
    card.classList.add(
      'iot-alert-critical'
    );
  } else {
    card.classList.add(
      'iot-alert-warning'
    );
  }


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
    threatNames[
      alert.type
    ] ||
    alert.type ||
    'IoT threat';


  const station =
    document.createElement(
      'span'
    );

  station.className =
    'iot-alert-station';

  station.textContent =
    alert.station_id ||
    'Unknown station';


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
    alert.severity ===
      'critical'
      ? 'pill e'
      : 'pill w';

  severity.textContent =
    alert.severity ===
      'critical'
      ? 'Critical'
      : 'Warning';


  heading.appendChild(
    titleArea
  );

  heading.appendChild(
    severity
  );

  card.appendChild(
    heading
  );


  const message =
    document.createElement(
      'p'
    );

  message.className =
    'iot-alert-description';

  message.textContent =
    alert.message ||
    'Threat detected.';

  card.appendChild(
    message
  );


  addAlertDetail(
    card,
    'Status',
    alert.status ===
      'active'
      ? 'Active'
      : 'Resolved'
  );


  addAlertDetail(
    card,
    'Sensor',
    formatAlertReading(
      alert
    )
  );


  addAlertDetail(
    card,
    'First detected',
    formatTime(
      alert.first_detected_at
    )
  );


  addAlertDetail(
    card,
    'Last detected',
    formatTime(
      alert.last_detected_at
    )
  );


  addAlertDetail(
    card,
    'Occurrences',
    String(
      alert.occurrence_count ??
      1
    )
  );


  if (
    alert.status ===
    'resolved'
  ) {
    addAlertDetail(
      card,
      'Resolved',
      formatTime(
        alert.resolved_at
      )
    );
  }


  return card;
}


function renderAlerts() {
  alertList.replaceChildren();

  criticalCount.textContent =
    alertSummary.critical ??
    0;

  warningCount.textContent =
    alertSummary.warning ??
    0;

  activeAlertCount.textContent =
    alertSummary.active ??
    0;


  if (
    currentAlerts.length ===
    0
  ) {
    alertMessage.textContent =
      alertFilter.value ===
      'active'
        ? 'No active threats detected.'
        : `No ${alertFilter.value} alerts to display.`;

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
      alertFilter.value ===
      'active'
        ? 'Monitoring normal'
        : 'No alerts';


    const text =
      document.createElement(
        'p'
      );

    text.textContent =
      alertFilter.value ===
      'active'
        ? 'No active sensor threat currently requires officer attention.'
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
    `Showing ${currentAlerts.length} ${alertFilter.value === 'all' ? '' : `${alertFilter.value} `}alerts.`;


  for (
    const alert of
    currentAlerts
  ) {
    alertList.appendChild(
      renderAlertCard(
        alert
      )
    );
  }
}


/* ============================================================
   COMPLETE DASHBOARD RENDER
   ============================================================ */

function renderDashboard() {
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
  dashboardSummary = {
    total_stations: 0,
    online_stations: 0,
    offline_stations: 0,
  };

  alertSummary = {
    active: 0,
    critical: 0,
    warning: 0,
  };

  latestReadings = [];

  recentReadings = [];

  currentAlerts = [];

  activeAlerts = [];

  selectedStation = '';

  renderSummary();

  renderStationOptions();

  clearSensorDisplay();

  telemetryBody.replaceChildren();

  const telemetryRow =
    document.createElement(
      'tr'
    );

  const telemetryCell =
    makeCell(
      message
    );

  telemetryCell.colSpan =
    8;

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
   * Cancel old request so repeated auto-refresh does not
   * allow old data to overwrite newer data.
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


    const alertStatus =
      encodeURIComponent(
        alertFilter.value
      );


    /*
     * Fetch dashboard data concurrently.
     */
    const [
      summaryResult,
      latestResult,
      readingsResult,
      alertsResult,
      activeAlertResult,
    ] =
      await Promise.all([
        fetchIoT(
          '/summary/live',
          token,
          controller.signal
        ),

        fetchIoT(
          '/latest',
          token,
          controller.signal
        ),

        fetchIoT(
          '/readings?limit=100',
          token,
          controller.signal
        ),

        fetchIoT(
          `/alerts/live?status=${alertStatus}&limit=100`,
          token,
          controller.signal
        ),

        /*
         * Always fetch active alerts separately so sensor
         * cards continue showing the current threat state
         * even when officer selects "Resolved".
         */
        fetchIoT(
          '/alerts/live?status=active&limit=100',
          token,
          controller.signal
        ),
      ]);


    if (
      controller.signal
        .aborted
    ) {
      return;
    }


    dashboardSummary =
      summaryResult.data ||
      {
        total_stations: 0,
        online_stations: 0,
        offline_stations: 0,
      };


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


    currentAlerts =
      Array.isArray(
        alertsResult.data
      )
        ? alertsResult.data
        : [];


    activeAlerts =
      Array.isArray(
        activeAlertResult.data
      )
        ? activeAlertResult.data
        : [];


    alertSummary =
      alertsResult.summary ||
      activeAlertResult.summary ||
      {
        active: 0,
        critical: 0,
        warning: 0,
      };


    renderDashboard();


    const now =
      new Date();

    lastUpdated.textContent =
      `Last updated ${now.toLocaleTimeString(
        'en-MY'
      )}`;


    setDashboardStatus(
      'live',
      'Live monitoring'
    );

  } catch (error) {
    if (
      controller.signal
        .aborted
    ) {
      return;
    }


    console.error(
      'IoT dashboard error:',
      error
    );


    const message =
      error instanceof
        Error
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
      currentRequest =
        null;

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
    void loadDashboard();
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
         * Do not repeatedly call backend when tab is hidden.
         */
        if (
          !document.hidden
        ) {
          void loadDashboard({
            silent: true,
          });
        }
      },

      AUTO_REFRESH_MS
    );
}


/*
 * When user comes back to the browser tab,
 * immediately refresh instead of waiting for next interval.
 */
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