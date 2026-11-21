// map.js - the Distribution map page.

drawMenu('map.html');

let map = null;
let markerLayer = null;
let sensorMarkerLayer = null;
let routeLayer = null;
let plants = [];
let sensorStations = [];
let fieldRoutes = [];

// "Show routes" is remembered in this browser only (localStorage may be unavailable).
const SHOW_ROUTES_KEY = 'niah_map_show_routes';

function readShowRoutes() {
  try {
    return localStorage.getItem(SHOW_ROUTES_KEY) !== 'false';
  } catch (error) {
    return true;
  }
}

function saveShowRoutes(show) {
  try {
    localStorage.setItem(SHOW_ROUTES_KEY, show ? 'true' : 'false');
  } catch (error) {
    // Not remembered; the map still works.
  }
}

// Creates the Leaflet map with its three map styles: satellite, street and topographic.
function createMap() {
  map = L.map('map-box').setView([3.2247, 113.7631], 14);

  const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/';

  const imagery = L.tileLayer(esri + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri'
  });

  const placeNames = L.tileLayer(esri + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri'
  });
  const satellite = L.layerGroup([imagery, placeNames]);

  const street = L.tileLayer(esri + 'World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri'
  });
  const topo = L.tileLayer(esri + 'World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri'
  });

  satellite.addTo(map);
  L.control.layers({ 'Satellite': satellite, 'Street': street, 'Topographic': topo }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
sensorMarkerLayer = L.layerGroup().addTo(map);
  // Trace routes: their own layer, shown or hidden with the "Show routes" checkbox.
  routeLayer = L.layerGroup();
  if (document.getElementById('map-show-routes').checked) {
    routeLayer.addTo(map);
  }
}

function escapePopupText(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

// The portal's one date format, date only here: "21 Nov 2026" (shared.js formatDay).
function displayVisitDate(value) {
  return formatDay(value, 'None');
}

function makePopup(plant) {
  const species = plant.species;
  const scientificName = species && species.scientific_name ? species.scientific_name : 'Unknown species';
  const commonName = species && species.common_name ? species.common_name : 'Unknown species';
  const sourceLine = plant.data_source === 'inaturalist'
    ? `Imported from iNaturalist · Observer: ${plant.source_observer || 'Unknown'} · Licence: ${plant.source_licence || 'Unknown'}`
    : 'Source: Field record (registered in the app)';
  return '<strong><em>' + escapePopupText(scientificName) + '</em></strong>' +
    '<div>Common name: ' + escapePopupText(commonName) + '</div>' +
    '<div>Tag: ' + escapePopupText(displayTag(plant.tag, 'No tag')) + '</div>' +
    '<div>Status: ' + escapePopupText(plant.status || 'Not recorded') + '</div>' +
    '<div>Landmark: ' + escapePopupText(plant.landmark || 'Not recorded') + '</div>' +
    '<div>' + escapePopupText(sourceLine) + '</div>' +
    '<div>Last visit: ' + escapePopupText(displayVisitDate(plant.last_visit)) + '</div>';
}

function drawSensorMarkers() {
  if (!map || !sensorMarkerLayer) return;

  sensorMarkerLayer.clearLayers();

  sensorStations.forEach(station => {
    const point = [station.latitude, station.longitude];

    const popup =
      '<strong>IoT Sensor Station</strong>' +
      '<div>Station: ' + escapePopupText(station.station_code) + '</div>' +
      '<div>Status: ' + escapePopupText(station.status || 'Unknown') + '</div>' +
      '<div>Location: ' + escapePopupText(station.location_note || 'Not recorded') + '</div>';

    L.circleMarker(point, {
      radius: 9,
      color: '#ffffff',
      weight: 2,
      fillColor: '#2389da',
      fillOpacity: 0.95
    })
      .bindPopup(popup)
      .addTo(sensorMarkerLayer);
  });
}

async function loadSensorStations() {
  const result = await api('/officer/map/stations');

  if (!result || !Array.isArray(result.data)) {
    throw new Error('The sensor station response was invalid.');
  }

sensorStations = result.data;
drawSensorMarkers();
drawMarkers(true);
}

function fillSpeciesFilter() {
  const select = document.getElementById('map-species');
  const selectedSpecies = select.value;
  const speciesById = new Map();
  plants.forEach(plant => {
    if (plant.species && plant.species.id) {
      speciesById.set(plant.species.id, plant.species);
    }
  });

  select.replaceChildren(new Option('All species', ''));
  [...speciesById.entries()]
    .sort((left, right) => (left[1].scientific_name || '').localeCompare(right[1].scientific_name || ''))
    .forEach(([id, species]) => {
      const label = species.scientific_name || species.common_name || 'Unknown species';
      select.add(new Option(label, id));
    });
  if (selectedSpecies && speciesById.has(selectedSpecies)) {
    select.value = selectedSpecies;
  }
}

function drawMarkers(zoomToFit) {
  if (map === null) {
    return;
  }

  markerLayer.clearLayers();
  const chosenSpecies = document.getElementById('map-species').value;
  const chosenStatus = document.getElementById('map-status').value;
  const points = [];

  plants.forEach(plant => {
    const speciesId = plant.species ? plant.species.id : '';
    const conservationStatus = plant.species ? plant.species.conservation_status : '';
    if (chosenSpecies && speciesId !== chosenSpecies) {
      return;
    }
    if (chosenStatus && conservationStatus !== chosenStatus) {
      return;
    }

    const point = [plant.latitude, plant.longitude];
    L.circleMarker(point, {
      radius: 8,
      color: '#ffffff',
      weight: 2,
      fillColor: '#3d8b4f',
      fillOpacity: 0.9
    }).bindPopup(makePopup(plant)).addTo(markerLayer);
    points.push(point);
  });

  document.getElementById('map-message').textContent =
    'Showing ' + points.length + ' plant' + (points.length === 1 ? '' : 's') + ' on the map.';
if (zoomToFit) {
  const sensorPoints = sensorStations.map(station => [
    station.latitude,
    station.longitude
  ]);

  const allPoints = [...points, ...sensorPoints];

  if (allPoints.length > 0) {
    map.fitBounds(L.latLngBounds(allPoints), {
      padding: [50, 50],
      maxZoom: 16
    });
  }
}
}

function resetMapFilters() {
  document.getElementById('map-species').value = '';
  document.getElementById('map-status').value = '';
  drawMarkers(true);
}

// ---- Trace routes (GET /api/officer/map/routes, officer only, last 90 days) ----

function displayRouteDistance(metres) {
  const value = Number(metres);
  if (!Number.isFinite(value)) return 'Not recorded';
  return value >= 1000 ? (value / 1000).toFixed(2) + ' km' : Math.round(value) + ' m';
}

function displayWalkingTime(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return 'Not recorded';
  const minutes = Math.max(1, Math.round(value / 60));
  if (minutes < 60) return minutes + ' min';
  return Math.floor(minutes / 60) + ' h ' + (minutes % 60) + ' min';
}

function makeRoutePopup(route) {
  const plant = route.plant;
  const plantLine = plant
    ? 'Plant: ' + escapePopupText(displayTag(plant.tag, 'No tag')) +
      (plant.scientific_name ? ' · <em>' + escapePopupText(plant.scientific_name) + '</em>' : '')
    : escapePopupText('Not linked to a plant');
  return '<strong>Trace route</strong>' +
    '<div>Botanist: ' + escapePopupText(route.recorded_by || 'Botanist') + '</div>' +
    '<div>Date: ' + escapePopupText(displayVisitDate(route.ended_at || route.started_at)) + '</div>' +
    '<div>Distance: ' + escapePopupText(displayRouteDistance(route.distance_m)) + '</div>' +
    '<div>Walking time: ' + escapePopupText(displayWalkingTime(route.duration_s)) + '</div>' +
    '<div>' + plantLine + '</div>';
}

// [lat, lng, time, accuracy] points with a usable position, as [lat, lng].
function routeLatLngs(route) {
  return (Array.isArray(route.points) ? route.points : [])
    .filter(point =>
      Array.isArray(point) &&
      Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
      point[0] >= -90 && point[0] <= 90 && point[1] >= -180 && point[1] <= 180)
    .map(point => [point[0], point[1]]);
}

function drawRoutes() {
  if (!map || !routeLayer) return;
  routeLayer.clearLayers();

  fieldRoutes.forEach(route => {
    const latLngs = routeLatLngs(route);
    if (latLngs.length === 0) return;
    const popup = makeRoutePopup(route);

    if (latLngs.length > 1) {
      L.polyline(latLngs, { color: '#d9822b', weight: 4, opacity: 0.85 })
        .bindPopup(popup)
        .addTo(routeLayer);
    }
    // Small start (white) and end (orange) circles.
    L.circleMarker(latLngs[0], { radius: 5, color: '#d9822b', weight: 2, fillColor: '#ffffff', fillOpacity: 1 })
      .bindPopup(popup)
      .addTo(routeLayer);
    L.circleMarker(latLngs[latLngs.length - 1], { radius: 5, color: '#ffffff', weight: 2, fillColor: '#d9822b', fillOpacity: 1 })
      .bindPopup(popup)
      .addTo(routeLayer);
  });
}

function toggleRoutes(show) {
  saveShowRoutes(show);
  if (!map || !routeLayer) return;
  if (show) {
    routeLayer.addTo(map);
  } else {
    routeLayer.remove();
  }
}

async function loadRoutes() {
  const result = await api('/officer/map/routes');
  if (!result || !Array.isArray(result.data)) {
    throw new Error('The routes response was invalid.');
  }
  fieldRoutes = result.data;
  drawRoutes();
  const count = fieldRoutes.length;
  document.getElementById('map-route-note').textContent =
    'Routes from the last 90 days: ' + count + ' route' + (count === 1 ? '' : 's') + '.';
}

async function loadPlants() {
  const result = await api('/officer/map/plants');
  if (!result || !Array.isArray(result.data)) {
    throw new Error('The plant locations response was invalid.');
  }
  plants = result.data;
  fillSpeciesFilter();
  drawMarkers(true);
}

if (pageAllowed === false) {
  // Not an officer (or not logged in): shared.js is already sending them away, so the
  // officer-only plant route is never called.
} else if (typeof L === 'undefined') {
  document.getElementById('map-message').textContent =
    'The map could not load. Check your internet connection and refresh the page.';
} else {
  document.getElementById('map-show-routes').checked = readShowRoutes();
  createMap();

  document.getElementById('map-message').textContent =
    'Loading plant and sensor locations...';

  loadPlants().catch(error => {
    document.getElementById('map-message').textContent =
      'Plant locations could not be loaded.';
    showUnexpectedError(error);
  });

  loadSensorStations().catch(error => {
    console.error('Sensor station locations could not be loaded:', error);
    document.getElementById('map-message').textContent +=
      ' Sensor station locations could not be loaded.';
  });

  // In parallel with the plants: if routes fail, the plants still show.
  loadRoutes().catch(error => {
    console.error('Routes could not be loaded:', error);
    document.getElementById('map-route-note').textContent = 'Routes could not be loaded.';
  });
}
