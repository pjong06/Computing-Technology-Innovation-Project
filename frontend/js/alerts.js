drawMenu('alerts.html');

/* DOM */

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

const sensorRain =
  document.getElementById('sensor-rain');

const temperatureStatus =
  document.getElementById('temperature-status');

const humidityStatus =
  document.getElementById('humidity-status');

const soilStatus =
  document.getElementById('soil-status');

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


/* State */

const AUTO_REFRESH_MS = 5000;
const ONLINE_WINDOW_MS = 60 * 1000;

let registeredStations = [];

let latestReadings = [];

let recentReadings = [];

let persistentAlerts = [];

let selectedStation = '';
let currentRequest = null;
let refreshTimer = null;

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

const resolutionDrafts =
  new Map();

const alertActionsInProgress =
  new Set();

const cameraEvidenceState =
  new Map();
const CAMERA_REFRESH_COOLDOWN_MS = 10000;

const cameraRefreshCooldowns = new Map();
function updateCameraRefreshButtons() {
  document.querySelectorAll('[data-camera-refresh-id]').forEach((button) => {
    const alertId = button.dataset.cameraRefreshId;
    const remaining = Math.max(
      0,
      Math.ceil(
        ((cameraRefreshCooldowns.get(alertId) || 0) - Date.now()) / 1000
      )
    );

    const loading = getCameraState(alertId).status === 'loading';

    button.textContent = loading
      ? 'Loading photo...'
      : remaining > 0
        ? `Refresh in ${remaining}s`
        : 'Refresh photo';

    button.disabled = loading || remaining > 0;
  });
}
/* General helpers */

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

  const text =
    String(value);

  return (
    text.charAt(0).toUpperCase() +
    text.slice(1)
  );
}

/* Staff name */

function getActorLabel(
  name,
  id
) {
  if (name) {
    return name;
  }

  if (id) {
    return (
      `Staff ${String(id).slice(
        0,
        8
      )}`
    );
  }

  return 'Unknown staff';
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

/* Registered station */

function getStation(
  stationId
) {
  return registeredStations.find(
    (station) =>
      station.id ===
        stationId ||
      station.station_code ===
        stationId
  );
}


function getStationName(
  stationId
) {
  const station =
    getStation(
      stationId
    );

  return (
    station?.station_code ||
    stationId ||
    'Unknown station'
  );
}


/* Latest persisted reading */

function buildLatestReadings(
  readings
) {
  const latest =
    new Map();

  for (
    const reading of
    readings
  ) {
    if (
      !reading.station_id
    ) {
      continue;
    }

    const existing =
      latest.get(
        reading.station_id
      );

    if (!existing) {
      latest.set(
        reading.station_id,
        reading
      );

      continue;
    }

    const currentTime =
      new Date(
        getReadingTime(
          reading
        ) || 0
      ).getTime();

    const existingTime =
      new Date(
        getReadingTime(
          existing
        ) || 0
      ).getTime();

    if (
      currentTime >
      existingTime
    ) {
      latest.set(
        reading.station_id,
        reading
      );
    }
  }

  return Array.from(
    latest.values()
  );
}


/* Online status from Supabase */

function calculateStationSummary() {
  const totalStations =
    registeredStations.length;

  let onlineStations =
    0;

  for (
    const station of
    registeredStations
  ) {
    const reading =
      latestReadings.find(
        (item) =>
          item.station_id ===
          station.id
      );

    if (
      reading &&
      isReadingOnline(
        reading
      )
    ) {
      onlineStations +=
        1;
    }
  }

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
}

function normalisePersistentStatus(
  status
) {
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


/* Auth and API */

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
    console.error(
      'IoT request failed:',
      {
        path,
        status:
          response.status,
        body,
      }
    );

    throw new Error(
      body.message ||
      `IoT request failed (${response.status}).`
    );
  }

  return body;
}


/* Dashboard status */

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
    state ===
    'live'
  ) {
    dashboardStatus.classList.add(
      'iot-status-live'
    );
  } else if (
    state ===
    'loading'
  ) {
    dashboardStatus.classList.add(
      'iot-status-loading'
    );
  } else {
    dashboardStatus.classList.add(
      'iot-status-error'
    );
  }

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


/* Summary */

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

  alertSummary = {
    unresolved:
      unresolved.length,

    critical,

    warning:
      unresolved.length -
      critical,
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


/* Station selector */

function renderStationOptions() {
  const previous =
    selectedStation ||
    stationFilter.value;

  stationFilter.replaceChildren();

  if (
    registeredStations.length ===
    0
  ) {
    const option =
      document.createElement(
        'option'
      );

    option.value =
      '';

    option.textContent =
      'No registered stations';

    stationFilter.appendChild(
      option
    );

    selectedStation =
      '';

    return;
  }

  for (
    const station of
    registeredStations
  ) {
    const option =
      document.createElement(
        'option'
      );

    option.value =
      station.id;

    option.textContent =
      station.station_code ||
      station.id;

    stationFilter.appendChild(
      option
    );
  }

  const stationIds =
    registeredStations.map(
      (station) =>
        station.id
    );

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


/* Live sensor helpers */

function findLiveAlert(
  stationId,
  type
) {
  const metricMap = {
    high_temperature:
      'temperature_c',

    low_soil_moisture:
      'soil_moisture_pct',

    heavy_rain:
      'rain_intensity_pct',

    high_humidity:
      'humidity_percent',
  };

  const targetMetric =
    metricMap[type];

  return persistentAlerts.find(
    (alert) => {
      if (
        alert.station_id !==
        stationId
      ) {
        return false;
      }

      if (
        !isUnresolvedAlert(
          alert
        )
      ) {
        return false;
      }

      const metric =
        getAlertMetric(
          alert
        );

      return (
        metric ===
        targetMetric
      );
    }
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


/* Sensor display */

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

  sensorRain.textContent =
    '–';

  temperatureStatus.textContent =
    'Waiting for reading';

  humidityStatus.textContent =
    'Waiting for reading';

  soilStatus.textContent =
    'Waiting for reading';

  rainStatus.textContent =
    'Waiting for reading';

  [
    sensorTemperature,
    sensorHumidity,
    sensorSoil,
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

const stationName =
  getStationName(
    reading.station_id
  );

selectedStationId.textContent =
  isReadingOnline(
    reading
  )
    ? `${stationName} · Online`
    : `${stationName} · Offline`;
  stationLastSeen.textContent =
    formatTime(
      getReadingTime(reading)
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

  /* Temperature */

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

  /* Humidity */

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

  /* Soil */

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

  /* Rain */

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


/* Telemetry */

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

    cell.colSpan =
      8;

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
      createCell(
        'No recent telemetry.'
      );

    cell.colSpan =
      8;

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
      getMotion(
        reading
      );

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


/* Alert helpers */

function getAlertMetric(alert) {
  const message =
    String(
      alert.alert_message || ''
    );

  const match =
    message.match(
      /\(([^()]+)\)\s*$/
    );

  return match
    ? match[1]
    : '';
}


function isCameraAlert(alert) {
  const message =
    String(
      alert.alert_message || ''
    ).toLowerCase();

  const metric =
    getAlertMetric(alert)
      .toLowerCase();

  return (
    metric ===
      'movement_nearby_cm' ||
    message.includes(
      'movement_nearby_cm'
    ) ||
    message.includes(
      'motion'
    ) ||
    message.includes(
      'movement'
    ) ||
    message.includes(
      'proximity'
    )
  );
}


function getAlertGroup(alert) {
  const message =
    String(
      alert.alert_message || ''
    ).toLowerCase();

  const metric =
    getAlertMetric(alert)
      .toLowerCase();

  if (
    metric.includes(
      'temperature'
    ) ||
    message.includes(
      'temperature'
    )
  ) {
    return 'temperature';
  }

  if (
    metric.includes(
      'humidity'
    ) ||
    message.includes(
      'humidity'
    )
  ) {
    return 'humidity';
  }

  if (
    metric.includes(
      'soil'
    ) ||
    message.includes(
      'soil'
    )
  ) {
    return 'soil';
  }

  if (
    metric.includes(
      'rain'
    ) ||
    message.includes(
      'rain'
    )
  ) {
    return 'rain';
  }

  return 'other';
}


function getGroupTitle(group) {
  switch (group) {
    case 'temperature':
      return 'Temperature alerts';

    case 'humidity':
      return 'Humidity alerts';

    case 'soil':
      return 'Soil moisture alerts';

    case 'rain':
      return 'Rain alerts';

    default:
      return 'Other alerts';
  }
}


function getAlertIcon(group) {
  switch (group) {
    case 'temperature':
      return '🌡️';

    case 'humidity':
      return '💧';

    case 'soil':
      return '🌱';

    case 'rain':
      return '🌧️';

    default:
      return '⚠️';
  }
}


function stripTrailingMetricSuffix(message) {
  const trimmedMessage =
    message.trimEnd();

  if (
    trimmedMessage.endsWith(')') === false
  ) {
    return message;
  }

  const openingIndex =
    trimmedMessage.lastIndexOf('(');
  const metric =
    trimmedMessage.slice(
      openingIndex + 1,
      -1
    );

  if (
    openingIndex === -1 ||
    metric.length === 0 ||
    metric.includes(')')
  ) {
    return message;
  }

  return trimmedMessage
    .slice(
      0,
      openingIndex
    )
    .trimEnd();
}


function isAlertWordCharacter(character) {
  if (character === '') {
    return false;
  }

  const code =
    character.charCodeAt(0);

  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95
  );
}


function findAlertSourceKeyword(message, keyword) {
  for (
    let keywordIndex = 0;
    keywordIndex <= message.length - keyword.length;
    keywordIndex++
  ) {
    let matchesKeyword = true;
    for (
      let offset = 0;
      offset < keyword.length;
      offset++
    ) {
      if (
        message[keywordIndex + offset].toLowerCase() !==
        keyword[offset]
      ) {
        matchesKeyword = false;
        break;
      }
    }

    if (matchesKeyword === false) {
      continue;
    }

    const previousCharacter =
      message[keywordIndex - 1];
    const nextCharacter =
      message[keywordIndex + keyword.length] || '';

    if (
      previousCharacter !== undefined &&
      previousCharacter.trim() === '' &&
      isAlertWordCharacter(nextCharacter) === false
    ) {
      let matchIndex =
        keywordIndex - 1;

      while (
        matchIndex > 0 &&
        message[matchIndex - 1].trim() === ''
      ) {
        matchIndex--;
      }

      return matchIndex;
    }
  }

  return -1;
}


function getAlertDisplayTitle(
  alert
) {
  if (
    isCameraAlert(
      alert
    )
  ) {
    return (
      'Movement detected near the camera'
    );
  }

  const group =
    getAlertGroup(
      alert
    );

  const message =
    String(
      alert.alert_message || ''
    );

  if (
    group ===
    'temperature'
  ) {
    const threshold =
      message.match(
        />\s*(\d+(?:\.\d+)?)/
      );

    if (threshold) {
      return (
        `Temperature above ${threshold[1]} °C`
      );
    }

    return (
      'High temperature detected'
    );
  }

  if (
    group ===
    'humidity'
  ) {
    return (
      'Humidity threshold alert'
    );
  }

  if (
    group ===
    'soil'
  ) {
    return (
      'Low soil moisture detected'
    );
  }

  if (
    group ===
    'rain'
  ) {
    return (
      'Heavy rainfall detected'
    );
  }

  return (
    stripTrailingMetricSuffix(message) ||
    'IoT threat alert'
  );
}


function getAlertSourceName(
  alert
) {
  const message =
    String(
      alert.alert_message || ''
    );

  const keywords = [
    'temperature',
    'humidity',
    'soil',
    'rain',
  ];

  for (
    const keyword of
    keywords
  ) {
    const matchIndex =
      findAlertSourceKeyword(
        message,
        keyword
      );

    if (
      matchIndex > 0
    ) {
      return message
        .slice(
          0,
          matchIndex
        )
        .trim();
    }
  }

  return (
    alert.station_id
      ? `Station ${alert.station_id}`
      : 'Monitoring station'
  );
}


function createSeverityPill(
  alert
) {
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

  return severity;
}


function createStatusPill(
  alert
) {
  const status =
    normalisePersistentStatus(
      alert.alert_status
    );

  const pill =
    document.createElement(
      'span'
    );

  pill.className =
    'pill';

  if (
    status ===
    'open'
  ) {
    pill.classList.add(
      'e'
    );

    pill.textContent =
      'Open';
  } else if (
    status ===
    'acknowledged'
  ) {
    pill.classList.add(
      'w'
    );

    pill.textContent =
      'Acknowledged';
  } else {
    pill.textContent =
      'Resolved';
  }

  return pill;
}


/* Camera evidence */



function setCameraState(
  alertId,
  state
) {
  cameraEvidenceState.set(
    alertId,
    state
  );
}


async function fetchCameraEvidence(
  alert,
  force = false
) {
  const current =
    getCameraState(
      alert.id
    );

if (current.status === 'loading') {
  return current;
}

  setCameraState(
    alert.id,
    {
      ...current,

      status:
        'loading',

      message:
        '',
    }
  );

  try {
    const token =
      await getAccessToken();

    const result =
      await requestIoT(
        `/alerts/${encodeURIComponent(
          alert.id
        )}/camera/cloud`,
        token
      );

    const evidence =
      Array.isArray(
        result.data
      )
        ? result.data
        : [];

    if (
  evidence.length === 0
) {
  const previous =
    getCameraState(
      alert.id
    );

  const retryCount =
    (
      previous.retryCount ||
      0
    ) + 1;

  const emptyState = {
    status:
      'empty',

    evidence:
      [],

    latest:
      null,

    url:
      null,

    expiresAt:
      0,

    message:
      '',

    retryCount,

    nextRetryAt:
      Date.now() +
      5000,
  };

  setCameraState(
    alert.id,
    emptyState
  );

  return emptyState;
}

    const latest =
      evidence[0];

    const urlResult =
      await requestIoT(
        `/alerts/${encodeURIComponent(
          alert.id
        )}/camera/${encodeURIComponent(
          latest.id
        )}/url`,
        token
      );

    if (
      !urlResult.url
    ) {
      throw new Error(
        'Camera photo URL is unavailable.'
      );
    }

    const expiresIn =
      Number(
        urlResult.expires_in
      );

    const readyState = {
      status:
        'ready',

      evidence,

      latest,

      url:
        urlResult.url,

      expiresAt:
        Date.now() +
        (
          Number.isFinite(
            expiresIn
          ) &&
          expiresIn > 0
            ? expiresIn *
              1000
            : 60000
        ),

      message:
        '',
      retryCount:
        0,
      nextRetryAt:
        0,
    };

    setCameraState(
      alert.id,
      readyState
    );

    return readyState;
  } catch (error) {
    console.error(
      'Camera evidence failed:',
      error
    );

  const previous =
    getCameraState(
      alert.id
    );

  const errorState = {
    ...previous,

    status:
      'error',

    url:
      null,

    expiresAt:
      0,

    message:
      error instanceof Error
        ? error.message
        : 'Could not load camera evidence.',

    retryCount:
      (
        previous.retryCount ||
        0
      ) + 1,

    nextRetryAt:
      Date.now() +
      5000,
  };

    setCameraState(
      alert.id,
      errorState
    );

    return errorState;
  }
}

function cameraNeedsRefresh(
  state
) {
  if (
    state.status ===
    'idle'
  ) {
    return true;
  }

  if (
    state.status ===
      'empty' ||
    state.status ===
      'error'
  ) {
    return (
      state.retryCount <
        3 &&
      Date.now() >=
        state.nextRetryAt
    );
  }

  if (
    state.status ===
      'ready'
  ) {
    return (
      !state.url ||
      Date.now() >=
        state.expiresAt -
          3000
    );
  }

  return false;
}

function queueCameraLoad(
  alert
) {
  const state =
    getCameraState(
      alert.id
    );

  if (
    !cameraNeedsRefresh(
      state
    )
  ) {
    return;
  }

  if (
    state.status ===
    'loading'
  ) {
    return;
  }

  setTimeout(
    async () => {
      await fetchCameraEvidence(
        alert
      );

      renderAlerts();
    },
    0
  );
}

function getCameraState(
  alertId
) {
  return (
    cameraEvidenceState.get(
      alertId
    ) || {
      status:
        'idle',

      evidence:
        [],

      latest:
        null,

      url:
        null,

      expiresAt:
        0,

      message:
        '',

      retryCount:
        0,

      nextRetryAt:
        0,
    }
  );
}


async function refreshCameraAlert(alert) {
  const now = Date.now();
  const state = getCameraState(alert.id);

  if (state.status === 'loading') {
    return;
  }

  const nextAllowedAt =
    cameraRefreshCooldowns.get(alert.id) || 0;

  if (now < nextAllowedAt) {
    return;
  }

  cameraRefreshCooldowns.set(
    alert.id,
    now + CAMERA_REFRESH_COOLDOWN_MS
  );

  renderAlerts();

  try {
    await fetchCameraEvidence(alert, true);
  } finally {
    renderAlerts();
  }
}

function showPhotoPopup(
  url,
  capturedAt
) {
  const overlay =
    document.createElement(
      'div'
    );

  overlay.style.position =
    'fixed';

  overlay.style.inset =
    '0';

  overlay.style.zIndex =
    '9999';

  overlay.style.background =
    'rgba(0, 0, 0, 0.82)';

  overlay.style.display =
    'flex';

  overlay.style.alignItems =
    'center';

  overlay.style.justifyContent =
    'center';

  overlay.style.padding =
    '24px';


  const modal =
    document.createElement(
      'div'
    );

  modal.style.position =
    'relative';

  modal.style.width =
    'min(1000px, 95vw)';

  modal.style.maxHeight =
    '92vh';

  modal.style.padding =
    '18px';

  modal.style.borderRadius =
    '18px';

  modal.style.background =
    'var(--card)';

  modal.style.border =
    '1px solid var(--line)';

  modal.style.boxShadow =
    '0 24px 80px rgba(0, 0, 0, 0.4)';


  const header =
    document.createElement(
      'div'
    );

  header.style.display =
    'flex';

  header.style.alignItems =
    'center';

  header.style.justifyContent =
    'space-between';

  header.style.gap =
    '16px';

  header.style.marginBottom =
    '14px';


  const title =
    document.createElement(
      'div'
    );

  title.innerHTML =
    `
      <strong style="display:block;font-size:16px;">
        Camera evidence
      </strong>

      <span style="font-size:12px;color:var(--mute);">
        Captured ${formatTime(capturedAt)}
      </span>
    `;


  const closeButton =
    document.createElement(
      'button'
    );

  closeButton.type =
    'button';

  closeButton.className =
    'btn ghost';

  closeButton.textContent =
    'Close';


  const image =
    document.createElement(
      'img'
    );

  image.src =
    url;

  image.alt =
    'Full camera evidence';

  image.style.display =
    'block';

  image.style.width =
    '100%';

  image.style.maxHeight =
    '75vh';

  image.style.objectFit =
    'contain';

  image.style.borderRadius =
    '14px';

  image.style.background =
    '#000';


  function closePopup() {
    overlay.remove();

    document.removeEventListener(
      'keydown',
      handleKeydown
    );
  }


  function handleKeydown(
    event
  ) {
    if (
      event.key ===
      'Escape'
    ) {
      closePopup();
    }
  }


  closeButton.addEventListener(
    'click',
    closePopup
  );


  overlay.addEventListener(
    'click',
    (
      event
    ) => {
      if (
        event.target ===
        overlay
      ) {
        closePopup();
      }
    }
  );


  document.addEventListener(
    'keydown',
    handleKeydown
  );


  header.appendChild(
    title
  );

  header.appendChild(
    closeButton
  );

  modal.appendChild(
    header
  );

  modal.appendChild(
    image
  );

  overlay.appendChild(
    modal
  );

  document.body.appendChild(
    overlay
  );
}

async function openFullPhoto(
  alert
) {
  let state =
    getCameraState(
      alert.id
    );

  if (
    state.status !==
      'ready' ||
    !state.url ||
    Date.now() >=
      state.expiresAt -
        3000
  ) {
    state =
      await fetchCameraEvidence(
        alert,
        true
      );

    renderAlerts();
  }

  if (
    state.status !==
      'ready' ||
    !state.url
  ) {
    notify(
      'No camera photo is available for this alert.'
    );

    return;
  }

  showPhotoPopup(
    state.url,
    state.latest
      ?.captured_at
  );
}

/* Delete alert */

function canDeleteAlerts() {
  const user =
    typeof getCurrentUser ===
      'function'
      ? getCurrentUser()
      : null;

  return (
    user?.role ===
    'Conservation Officer'
  );
}


async function deleteAlert(
  alert
) {
  if (
    alertActionsInProgress.has(
      alert.id
    )
  ) {
    return;
  }

  const status =
    normalisePersistentStatus(
      alert.alert_status
    );

  const cameraWarning =
    isCameraAlert(alert)
      ? '\n\nLinked camera evidence will also be deleted.'
      : '';

  const confirmed =
    window.confirm(
      `Permanently delete this ${status} threat alert?${cameraWarning}\n\nSensor telemetry will be kept.\n\nThis cannot be undone.`
    );

  if (!confirmed) {
    return;
  }

  alertActionsInProgress.add(
    alert.id
  );

  renderAlerts();

  try {
    const token =
      await getAccessToken();

    const result =
      await requestIoT(
        `/alerts/${encodeURIComponent(
          alert.id
        )}`,
        token,
        {
          method:
            'DELETE',
        }
      );

    resolutionDrafts.delete(
      alert.id
    );

    cameraEvidenceState.delete(
      alert.id
    );

    if (
      result.data
        ?.camera_cleanup_pending
    ) {
      notify(
        'Alert deleted. Camera cleanup needs attention.'
      );
    } else {
      notify(
        'Alert deleted permanently.'
      );
    }

    await loadDashboard({
      silent:
        true,
    });
  } catch (error) {
    console.error(
      'Delete alert failed:',
      error
    );

    notify(
      error instanceof Error
        ? error.message
        : 'Could not delete alert.'
    );
  } finally {
    alertActionsInProgress.delete(
      alert.id
    );

    renderAlerts();
  }
}

/* Alert actions */
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

    await requestIoT(
      `/alerts/${encodeURIComponent(
        alert.id
      )}/${action}`,
      token,
      {
        method:
          'PATCH',

        body:
          action ===
          'resolve'
            ? {
                resolution_notes:
                  notes.trim(),
              }
            : {},
      }
    );

    if (
      action ===
      'resolve'
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

    /* Keep the updated alert visible */

    alertFilter.value =
      'all';

    await loadDashboard({
      silent:
        true,
    });
  } catch (error) {
    console.error(
      'Alert action failed:',
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


async function acknowledgeAlertGroup(
  alerts
) {
  const openAlerts =
    alerts.filter(
      (alert) =>
        normalisePersistentStatus(
          alert.alert_status
        ) ===
        'open'
    );

  if (
    openAlerts.length === 0
  ) {
    return;
  }

  for (
    const alert of
    openAlerts
  ) {
    alertActionsInProgress.add(
      alert.id
    );
  }

  renderAlerts();

  try {
    const token =
      await getAccessToken();

    for (
      const alert of
      openAlerts
    ) {
      await requestIoT(
        `/alerts/${encodeURIComponent(
          alert.id
        )}/acknowledge`,
        token,
        {
          method:
            'PATCH',

          body:
            {},
        }
      );
    }

    notify(
      `${openAlerts.length} alerts acknowledged.`
    );

    await loadDashboard({
      silent:
        true,
    });
  } catch (error) {
    console.error(
      'Bulk acknowledge failed:',
      error
    );

    notify(
      error instanceof Error
        ? error.message
        : 'Could not acknowledge all alerts.'
    );
  } finally {
    for (
      const alert of
      openAlerts
    ) {
      alertActionsInProgress.delete(
        alert.id
      );
    }

    renderAlerts();
  }
}


/* Camera alert card */

function renderCameraAlertCard( alert) {
  const status =
    normalisePersistentStatus(
      alert.alert_status
    );

  const busy =
    alertActionsInProgress.has(
      alert.id
    );

  const state =
    getCameraState(
      alert.id
    );

  const card =
    document.createElement(
      'article'
    );

  card.className =
    'card iot-alert-card iot-alert-critical';

  card.style.gridColumn =
    '1 / -1';

  card.style.padding =
    '0';

  card.style.overflow =
    'hidden';

  const layout =
    document.createElement(
      'div'
    );

  layout.style.display =
    'flex';

  layout.style.flexWrap =
    'wrap';

  layout.style.minHeight =
    '300px';

  /* Photo side */

  const photoSide =
    document.createElement(
      'div'
    );

  photoSide.style.flex =
    '1 1 520px';

  photoSide.style.minWidth =
    '300px';

  photoSide.style.position =
    'relative';

  photoSide.style.background =
    '#07110d';

  photoSide.style.display =
    'flex';

  photoSide.style.alignItems =
    'center';

  photoSide.style.justifyContent =
    'center';

  photoSide.style.minHeight =
    '300px';

  if (
    state.status ===
      'ready' &&
    state.url &&
    Date.now() <
      state.expiresAt -
        3000
  ) {
    const image =
      document.createElement(
        'img'
      );

    image.src =
      state.url;

    image.alt =
      'Captured camera evidence';

    image.style.width =
      '100%';

    image.style.height =
      '100%';

    image.style.maxHeight =
      '330px';

    image.style.objectFit =
      'cover';

    image.style.display =
      'block';

    image.addEventListener(
      'error',
      () => {
        setCameraState(
          alert.id,
          {
            ...state,

            status:
              'idle',

            url:
              null,

            expiresAt:
              0,
          }
        );

        renderAlerts();
      }
    );

    photoSide.appendChild(
      image
    );

    const cameraLabel =
      document.createElement(
        'span'
      );

    cameraLabel.textContent =
      `CAM 01  ${formatTime(
        state.latest
          ?.captured_at
      )}`;

    cameraLabel.style.position =
      'absolute';

    cameraLabel.style.top =
      '14px';

    cameraLabel.style.left =
      '16px';

    cameraLabel.style.fontSize =
      '11px';

    cameraLabel.style.fontWeight =
      '700';

    cameraLabel.style.color =
      '#c7f5da';

    cameraLabel.style.fontFamily =
      'monospace';

    photoSide.appendChild(
      cameraLabel
    );
  } else {
    const empty =
      document.createElement(
        'div'
      );

    empty.style.textAlign =
      'center';

    empty.style.padding =
      '30px';

    const icon =
      document.createElement(
        'div'
      );

    icon.textContent =
      '📷';

    icon.style.fontSize =
      '42px';

    icon.style.marginBottom =
      '10px';

    const text =
      document.createElement(
        'div'
      );

    text.style.color =
      '#9ab4a5';

    text.style.fontSize =
      '13px';

    if (
      state.status ===
      'loading'
    ) {
      text.textContent =
        'Loading camera evidence...';
    } else if (
      state.status ===
      'empty'
    ) {
      text.textContent =
        'No photo captured for this alert.';
    } else if (
      state.status ===
      'error'
    ) {
      text.textContent =
        state.message ||
        'Camera evidence unavailable.';
    } else {
      text.textContent =
        'Checking camera evidence...';
    }

    empty.appendChild(
      icon
    );

    empty.appendChild(
      text
    );

    photoSide.appendChild(
      empty
    );
  }

  /* Alert information side */

  const detailSide =
    document.createElement(
      'div'
    );

  detailSide.style.flex =
    '1 1 420px';

  detailSide.style.minWidth =
    '300px';

  detailSide.style.padding =
    '24px';

  detailSide.style.display =
    'flex';

  detailSide.style.flexDirection =
    'column';

  const pills =
    document.createElement(
      'div'
    );

  pills.style.display =
    'flex';

  pills.style.gap =
    '8px';

  pills.style.alignItems =
    'center';

  pills.style.marginBottom =
    '14px';

  pills.appendChild(
    createSeverityPill(
      alert
    )
  );

  pills.appendChild(
    createStatusPill(
      alert
    )
  );

  detailSide.appendChild(
    pills
  );

  const title =
    document.createElement(
      'h3'
    );

  title.textContent =
    'Movement detected near the camera';

  title.style.margin =
    '0 0 5px';

  title.style.fontSize =
    '20px';

  title.style.color =
    'var(--ink)';

  detailSide.appendChild(
    title
  );

  const metric =
    document.createElement(
      'div'
    );

  metric.textContent =
    getAlertMetric(
      alert
    ) ||
    'movement_nearby_cm';

  metric.style.color =
    'var(--mute)';

  metric.style.fontSize =
    '12px';

  metric.style.marginBottom =
    '20px';

  detailSide.appendChild(
    metric
  );

  const info =
    document.createElement(
      'div'
    );

  info.style.display =
    'grid';

  info.style.gridTemplateColumns =
    '120px minmax(0, 1fr)';

  info.style.gap =
    '10px 18px';

  info.style.fontSize =
    '12px';

  function addInfo(
    label,
    value
  ) {
    const name =
      document.createElement(
        'span'
      );

    name.textContent =
      label;

    name.style.color =
      'var(--mute)';

    const content =
      document.createElement(
        'strong'
      );

    content.textContent =
      value;

    content.style.color =
      'var(--ink)';

    content.style.fontWeight =
      '600';

    content.style.textAlign =
      'right';

    content.style.wordBreak =
      'break-word';

    info.appendChild(
      name
    );

    info.appendChild(
      content
    );
  }

  addInfo(
    'Triggered',
    formatTime(
      alert.triggered_at
    )
  );

  addInfo(
    'Station',
    alert.station_id ||
      'Unknown'
  );

  if (
    alert.reading_id
  ) {
    addInfo(
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
  addInfo(
    'Acknowledged by',
    getActorLabel(
      alert
        .acknowledged_by_name,
      alert
        .acknowledged_by
    )
  );

  addInfo(
    'Acknowledged at',
    formatTime(
      alert
        .acknowledged_at
    )
  );
}

if (
  status ===
  'resolved'
) {
  addInfo(
    'Resolved by',
    getActorLabel(
      alert
        .resolved_by_name,
      alert
        .resolved_by
    )
  );

  addInfo(
    'Resolved at',
    formatTime(
      alert
        .resolved_at
    )
  );
}

  detailSide.appendChild(
    info
  );

  /* Resolution */

  if (
    status ===
    'acknowledged'
  ) {
    const resolveBox =
      document.createElement(
        'div'
      );

    resolveBox.style.marginTop =
      '18px';

    const textarea =
      document.createElement(
        'textarea'
      );

    textarea.className =
      'iot-resolution-input';

    textarea.rows =
      3;

    textarea.maxLength =
      2000;

    textarea.placeholder =
      'Resolution notes';

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

    resolveBox.appendChild(
      textarea
    );

    detailSide.appendChild(
      resolveBox
    );
  }

  if (
    status ===
      'resolved' &&
    alert.resolution_notes
  ) {
    const resolution =
      document.createElement(
        'p'
      );

    resolution.textContent =
      `Resolution: ${alert.resolution_notes}`;

    resolution.style.color =
      'var(--mute)';

    resolution.style.fontSize =
      '12px';

    resolution.style.marginTop =
      '16px';

    detailSide.appendChild(
      resolution
    );
  }

  /* Actions */

  const actions =
    document.createElement(
      'div'
    );

  actions.style.display =
    'flex';

  actions.style.flexWrap =
    'wrap';

  actions.style.gap =
    '10px';

  actions.style.marginTop =
    'auto';

  actions.style.paddingTop =
    '22px';

  if (
    status ===
    'open'
  ) {
    const acknowledge =
      document.createElement(
        'button'
      );

    acknowledge.type =
      'button';

    acknowledge.className =
      'btn';

    acknowledge.textContent =
      busy
        ? 'Working...'
        : 'Acknowledge';

    acknowledge.disabled =
      busy;

    acknowledge.addEventListener(
      'click',
      () => {
        void performAlertAction(
          alert,
          'acknowledge'
        );
      }
    );

    actions.appendChild(
      acknowledge
    );
  }

  if (
    status ===
    'acknowledged'
  ) {
    const resolve =
      document.createElement(
        'button'
      );

    resolve.type =
      'button';

    resolve.className =
      'btn';

    resolve.textContent =
      busy
        ? 'Working...'
        : 'Resolve alert';

    resolve.disabled =
      busy;

    resolve.addEventListener(
      'click',
      () => {
        void performAlertAction(
          alert,
          'resolve',
          resolutionDrafts.get(
            alert.id
          ) || ''
        );
      }
    );

    actions.appendChild(
      resolve
    );
  }

  if (
    state.status ===
    'ready' &&
    state.url
  ) {
    const fullPhoto =
      document.createElement(
        'button'
      );

    fullPhoto.type =
      'button';

    fullPhoto.className =
      'btn ghost';

    fullPhoto.textContent =
      'View full photo';

    fullPhoto.addEventListener(
      'click',
      () => {
        void openFullPhoto(
          alert
        );
      }
    );

    actions.appendChild(
      fullPhoto
    );
  }

  const refreshPhoto =
    document.createElement(
      'button'
    );

  refreshPhoto.type =
    'button';

  refreshPhoto.className =
    'btn ghost';
refreshPhoto.dataset.cameraRefreshId = alert.id;
const remainingCooldown = Math.max(
  0,
  Math.ceil(
    ((cameraRefreshCooldowns.get(alert.id) || 0) - Date.now()) / 1000
  )
);

refreshPhoto.textContent =
  state.status === 'loading'
    ? 'Loading photo...'
    : remainingCooldown > 0
      ? `Refresh in ${remainingCooldown}s`
      : 'Refresh photo';

refreshPhoto.disabled =
  state.status === 'loading' || remainingCooldown > 0;

  refreshPhoto.addEventListener(
    'click',
    () => {
      void refreshCameraAlert(
        alert
      );
    }
  );

  actions.appendChild(
    refreshPhoto
  );

  
    if (canDeleteAlerts()) {
  const deleteButton =
    document.createElement(
      'button'
    );

  deleteButton.type =
    'button';

  deleteButton.className =
    'btn ghost';

  deleteButton.style.color =
  '#ff7b7b';

  deleteButton.style.borderColor =
    '#a83b3b';

  deleteButton.style.background =
    'rgba(168, 59, 59, 0.12)';

  deleteButton.textContent =
    busy
      ? 'Working...'
      : 'Delete alert';

  deleteButton.disabled =
    busy;

  deleteButton.addEventListener(
    'click',
    () => {
      void deleteAlert(
        alert
      );
    }
  );

  actions.appendChild(
    deleteButton
  );
}

  detailSide.appendChild(
    actions
  );

  layout.appendChild(
    photoSide
  );

  layout.appendChild(
    detailSide
  );

  card.appendChild(
    layout
  );

  queueCameraLoad(
    alert
  );

  return card;
}


/* Compact alert row */

function renderCompactAlertRow(
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

  const group =
    getAlertGroup(
      alert
    );

  const row =
    document.createElement(
      'div'
    );

  row.style.display =
    'flex';

  row.style.flexWrap =
    'wrap';

  row.style.alignItems =
    'center';

  row.style.gap =
    '14px';

  row.style.padding =
    '15px 18px';

  row.style.borderTop =
    '1px solid var(--line)';

  const icon =
    document.createElement(
      'div'
    );

  icon.textContent =
    getAlertIcon(
      group
    );

  icon.style.width =
    '42px';

  icon.style.height =
    '42px';

  icon.style.flex =
    '0 0 42px';

  icon.style.display =
    'flex';

  icon.style.alignItems =
    'center';

  icon.style.justifyContent =
    'center';

  icon.style.borderRadius =
    '12px';

  icon.style.background =
    'var(--mint)';

  icon.style.fontSize =
    '18px';

  row.appendChild(
    icon
  );

  const main =
    document.createElement(
      'div'
    );

  main.style.flex =
    '1 1 320px';

  main.style.minWidth =
    '220px';

  const titleRow =
    document.createElement(
      'div'
    );

  titleRow.style.display =
    'flex';

  titleRow.style.flexWrap =
    'wrap';

  titleRow.style.alignItems =
    'center';

  titleRow.style.gap =
    '8px';

  const title =
    document.createElement(
      'strong'
    );

  title.textContent =
    getAlertDisplayTitle(
      alert
    );

  title.style.fontSize =
    '14px';

  title.style.color =
    'var(--ink)';

  titleRow.appendChild(
    title
  );

  titleRow.appendChild(
    createSeverityPill(
      alert
    )
  );

  main.appendChild(
    titleRow
  );

  const meta =
    document.createElement(
      'div'
    );

  let metaText =
    `${getAlertSourceName(
      alert
    )} · ${formatTime(
      alert.triggered_at
    )} · ${capitalise(
      status
    )}`;


  if (
    status ===
      'acknowledged' ||
    status ===
      'resolved'
  ) {
    metaText +=
      ` · Acknowledged by ${getActorLabel(
        alert
          .acknowledged_by_name,
        alert
          .acknowledged_by
      )}`;
  }


  if (
    status ===
    'resolved'
  ) {
    metaText +=
      ` · Resolved by ${getActorLabel(
        alert
          .resolved_by_name,
        alert
          .resolved_by
      )}`;
  }


  meta.textContent =
    metaText;

  meta.style.color =
    'var(--mute)';

  meta.style.fontSize =
    '11.5px';

  meta.style.marginTop =
    '3px';

  main.appendChild(
    meta
  );

  if (
    status ===
      'acknowledged'
  ) {
    const textarea =
      document.createElement(
        'textarea'
      );

    textarea.className =
      'iot-resolution-input';

    textarea.rows =
      2;

    textarea.maxLength =
      2000;

    textarea.placeholder =
      'Resolution notes';

    textarea.value =
      resolutionDrafts.get(
        alert.id
      ) || '';

    textarea.disabled =
      busy;

    textarea.style.marginTop =
      '9px';

    textarea.addEventListener(
      'input',
      () => {
        resolutionDrafts.set(
          alert.id,
          textarea.value
        );
      }
    );

    main.appendChild(
      textarea
    );
  }

  if (
    status ===
      'resolved' &&
    alert.resolution_notes
  ) {
    const resolution =
      document.createElement(
        'div'
      );

    resolution.textContent =
      `Resolution: ${alert.resolution_notes}`;

    resolution.style.color =
      'var(--mute)';

    resolution.style.fontSize =
      '11.5px';

    resolution.style.marginTop =
      '6px';

    main.appendChild(
      resolution
    );
  }

  if (
      canDeleteAlerts()
    ) {
      const deleteButton =
        document.createElement(
          'button'
        );

      deleteButton.type =
        'button';

      deleteButton.className =
        'btn ghost small';

      deleteButton.style.color =
        '#ff7b7b';

      deleteButton.style.borderColor =
        '#a83b3b';

      deleteButton.style.background =
        'rgba(168, 59, 59, 0.12)';

      deleteButton.textContent =
        busy
          ? 'Working...'
          : 'Delete';

      deleteButton.disabled =
        busy;

      deleteButton.addEventListener(
        'click',
        () => {
          void deleteAlert(
            alert
          );
        }
      );

      action.appendChild(
        deleteButton
      );
    }


  row.appendChild(
    main
  );

  if (
    alert.reading_id
  ) {
    const reading =
      document.createElement(
        'span'
      );

    reading.textContent =
      alert.reading_id;

    reading.title =
      alert.reading_id;

    reading.style.maxWidth =
      '180px';

    reading.style.overflow =
      'hidden';

    reading.style.textOverflow =
      'ellipsis';

    reading.style.whiteSpace =
      'nowrap';

    reading.style.color =
      'var(--mute)';

    reading.style.fontFamily =
      'monospace';

    reading.style.fontSize =
      '11px';

    row.appendChild(
      reading
    );
  }

  const action =
    document.createElement(
      'div'
    );

  action.style.flex =
    '0 0 auto';

  if (
    status ===
    'open'
  ) {
    const button =
      document.createElement(
        'button'
      );

    button.type =
      'button';

    button.className =
      'btn small';

    button.textContent =
      busy
        ? 'Working...'
        : 'Acknowledge';

    button.disabled =
      busy;

    button.addEventListener(
      'click',
      () => {
        void performAlertAction(
          alert,
          'acknowledge'
        );
      }
    );

    action.appendChild(
      button
    );
  }

  if (
    status ===
    'acknowledged'
  ) {
    const button =
      document.createElement(
        'button'
      );

    button.type =
      'button';

    button.className =
      'btn small';

    button.textContent =
      busy
        ? 'Working...'
        : 'Resolve';

    button.disabled =
      busy;

    button.addEventListener(
      'click',
      () => {
        void performAlertAction(
          alert,
          'resolve',
          resolutionDrafts.get(
            alert.id
          ) || ''
        );
      }
    );

    action.appendChild(
      button
    );
  }

  if (
    status ===
    'resolved'
  ) {
    action.appendChild(
      createStatusPill(
        alert
      )
    );
  }

  row.appendChild(
    action
  );

  return row;
}


/* Compact alert group */

function renderCompactAlertGroup(
  group,
  alerts
) {
  const section =
    document.createElement(
      'section'
    );

  section.style.gridColumn =
    '1 / -1';

  section.style.marginTop =
    '16px';

  const header =
    document.createElement(
      'div'
    );

  header.style.display =
    'flex';

  header.style.alignItems =
    'center';

  header.style.justifyContent =
    'space-between';

  header.style.gap =
    '16px';

  header.style.marginBottom =
    '10px';

  const title =
    document.createElement(
      'div'
    );

  const name =
    document.createElement(
      'strong'
    );

  name.textContent =
    getGroupTitle(
      group
    );

  name.style.fontSize =
    '14px';

  name.style.color =
    'var(--ink)';

  const openCount =
    alerts.filter(
      (alert) =>
        normalisePersistentStatus(
          alert.alert_status
        ) ===
        'open'
    ).length;

  const count =
    document.createElement(
      'span'
    );

  count.textContent =
    ` ${openCount} open`;

  count.style.color =
    'var(--mute)';

  count.style.fontWeight =
    '400';

  name.appendChild(
    count
  );

  title.appendChild(
    name
  );

  header.appendChild(
    title
  );

  if (
    openCount > 1
  ) {
    const acknowledgeAll =
      document.createElement(
        'button'
      );

    acknowledgeAll.type =
      'button';

    acknowledgeAll.className =
      'btn ghost small';

    acknowledgeAll.textContent =
      'Acknowledge all';

    acknowledgeAll.addEventListener(
      'click',
      () => {
        void acknowledgeAlertGroup(
          alerts
        );
      }
    );

    header.appendChild(
      acknowledgeAll
    );
  }

  section.appendChild(
    header
  );

  const list =
    document.createElement(
      'div'
    );

  list.className =
    'card';

  list.style.padding =
    '0';

  list.style.overflow =
    'hidden';

  alerts.forEach(
    (
      alert,
      index
    ) => {
      const row =
        renderCompactAlertRow(
          alert
        );

      if (
        index === 0
      ) {
        row.style.borderTop =
          'none';
      }

      list.appendChild(
        row
      );
    }
  );

  section.appendChild(
    list
  );

  return section;
}


/* Alert list */

function getFilteredPersistentAlerts() {
  const filter =
    alertFilter.value;

  if (
    filter ===
    'all'
  ) {
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

  alertList.style.display =
    'grid';

  alertList.style.gridTemplateColumns =
    '1fr';

  alertList.style.gap =
    '14px';

  calculateAlertSummary();
  renderSummary();

  const alerts =
    getFilteredPersistentAlerts();

  if (
    alerts.length === 0
  ) {
    alertMessage.textContent =
      alertFilter.value ===
      'open'
        ? 'No open alerts require attention.'
        : 'No alerts in this category.';

    const empty =
      document.createElement(
        'div'
      );

    empty.className =
      'card iot-empty-alert';

    empty.style.gridColumn =
      '1 / -1';

    empty.textContent =
      'No persistent IoT alerts to display.';

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

  const cameraAlerts =
    alerts.filter(
      isCameraAlert
    );

  const otherAlerts =
    alerts.filter(
      (alert) =>
        !isCameraAlert(
          alert
        )
    );

  for (
    const alert of
    cameraAlerts
  ) {
    alertList.appendChild(
      renderCameraAlertCard(
        alert
      )
    );
  }

  const groupOrder = [
    'temperature',
    'humidity',
    'soil',
    'rain',
    'other',
  ];

  for (
    const group of
    groupOrder
  ) {
    const groupAlerts =
      otherAlerts.filter(
        (alert) =>
          getAlertGroup(
            alert
          ) === group
      );

    if (
      groupAlerts.length === 0
    ) {
      continue;
    }

    alertList.appendChild(
      renderCompactAlertGroup(
        group,
        groupAlerts
      )
    );
  }

  const knownIds =
    new Set(
      persistentAlerts.map(
        (alert) =>
          alert.id
      )
    );

  for (
    const id of
    cameraEvidenceState.keys()
  ) {
    if (
      !knownIds.has(id)
    ) {
      cameraEvidenceState.delete(
        id
      );
    }
  }
}


/* Dashboard render */

function renderDashboard() {
  calculateAlertSummary();
  renderSummary();
  renderStationOptions();
  renderSelectedStation();
  renderTelemetry();
  renderAlerts();
}


/* Reset */

function resetDashboard(
  message
) {
  registeredStations =
  [];

  latestReadings =
    [];

  recentReadings =
    [];

  persistentAlerts =
    [];

  dashboardSummary = {
    total_stations:
      0,

    online_stations:
      0,

    offline_stations:
      0,
  };

  alertSummary = {
    unresolved:
      0,

    critical:
      0,

    warning:
      0,
  };

  renderSummary();
  renderStationOptions();
  clearSensorDisplay();

  telemetryBody.replaceChildren();

  const row =
    document.createElement(
      'tr'
    );

  const cell =
    createCell(
      message
    );

  cell.colSpan =
    8;

  cell.className =
    'iot-empty-cell';

  row.appendChild(
    cell
  );

  telemetryBody.appendChild(
    row
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


/* Load dashboard */

async function loadDashboard({
  silent = false,
} = {}) {
  if (
    currentRequest
  ) {
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

    /* Read dashboard data from Supabase through backend */

    const [
      stationResult,
      historyResult,
      alertResult,
    ] =
      await Promise.all([
        requestIoT(
          '/summary',
          token,
          {
            signal:
              controller.signal,
          }
        ),

        requestIoT(
          '/readings/history',
          token,
          {
            signal:
              controller.signal,
          }
        ),

        requestIoT(
          '/alerts',
          token,
          {
            signal:
              controller.signal,
          }
        ),
      ]);

    if (
      controller.signal
        .aborted
    ) {
      return;
    }

    /* Registered stations */

    registeredStations =
      Array.isArray(
        stationResult
          .data
          ?.stations
      )
        ? stationResult
            .data
            .stations
        : [];

    /* Persistent telemetry */

    recentReadings =
      Array.isArray(
        historyResult.data
      )
        ? historyResult.data
        : [];

    recentReadings.sort(
      (
        a,
        b
      ) =>
        new Date(
          getReadingTime(
            b
          ) || 0
        ).getTime() -
        new Date(
          getReadingTime(
            a
          ) || 0
        ).getTime()
    );

    /* Latest reading for each station */

    latestReadings =
      buildLatestReadings(
        recentReadings
      );

    /* Online/offline from latest persisted reading */

    calculateStationSummary();

    /* Persistent threat alerts */

    persistentAlerts =
      Array.isArray(
        alertResult.data
      )
        ? alertResult.data
        : [];

    persistentAlerts.sort(
      (
        a,
        b
      ) =>
        new Date(
          b.triggered_at ||
            0
        ).getTime() -
        new Date(
          a.triggered_at ||
            0
        ).getTime()
    );

    renderDashboard();

    const now =
      new Date();

    lastUpdated.textContent =
      `Last updated ${now.toLocaleTimeString(
        'en-MY'
      )}`;

    setDashboardStatus(
      'live',
      'Live data'
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
      currentRequest =
        null;

      refreshButton.disabled =
        false;
    }
  }
}


/* Events */

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


/* Auto refresh */

function startAutoRefresh() {
  if (
    refreshTimer
  ) {
    clearInterval(
      refreshTimer
    );
  }

  refreshTimer =
    setInterval(
      () => {
        if (
          document.hidden
        ) {
          return;
        }

        void loadDashboard({
          silent:
            true,
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
        silent:
          true,
      });
    }
  }
);


/* Start */

clearSensorDisplay();

void loadDashboard();

startAutoRefresh();


setInterval(() => {
  if (!document.hidden) {
    updateCameraRefreshButtons();
  }
}, 1000);