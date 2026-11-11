// map.js - the Distribution map page.

drawMenu('map.html');

let map = null;
let markerLayer = null;
let plants = [];

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

function displayVisitDate(value) {
  if (!value) {
    return 'None';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function makePopup(plant) {
  const species = plant.species;
  const scientificName = species && species.scientific_name ? species.scientific_name : 'Unknown species';
  const commonName = species && species.common_name ? species.common_name : 'Unknown species';
  return '<strong><em>' + escapePopupText(scientificName) + '</em></strong>' +
    '<div>Common name: ' + escapePopupText(commonName) + '</div>' +
    '<div>Tag: ' + escapePopupText(plant.tag || 'No tag') + '</div>' +
    '<div>Status: ' + escapePopupText(plant.status || 'Not recorded') + '</div>' +
    '<div>Landmark: ' + escapePopupText(plant.landmark || 'Not recorded') + '</div>' +
    '<div>Last visit: ' + escapePopupText(displayVisitDate(plant.last_visit)) + '</div>';
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
  if (zoomToFit && points.length > 0) {
    map.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 16 });
  }
}

function resetMapFilters() {
  document.getElementById('map-species').value = '';
  document.getElementById('map-status').value = '';
  drawMarkers(true);
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
  createMap();
  document.getElementById('map-message').textContent = 'Loading plant locations...';
  loadPlants().catch(error => {
    document.getElementById('map-message').textContent = 'Plant locations could not be loaded.';
    showUnexpectedError(error);
  });
}
