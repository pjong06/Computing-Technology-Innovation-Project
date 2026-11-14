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

  const legend = L.control({ position: 'bottomright' });

legend.onAdd = function () {
  const div = L.DomUtil.create('div');

  div.style.cssText = `
    background: white;
    padding: 12px;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    font-size: 12px;
    line-height: 24px;
  `;

  div.innerHTML = `
    <strong>Conservation Status</strong><br>
    RED - (CR)Critically Endangered<br>
    ORANGE - (EN)Endangered<br>
    YELLOW - (VU)Vulnerable<br>
    BLUE - (NT)Near Threatened<br>
    GREEN - (LC)Least Concern<br>
    WHITE - (DD)Data Deficient
  `;

  return div;
};

legend.addTo(map);
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
  const species = plant.species || {};

  const scientificName =
    species.scientific_name || 'Unknown species';

  const commonName =
    species.common_name || 'Not recorded';

  const conservationStatus =
    species.conservation_status || 'Not assessed';

  const latitude = Number(plant.latitude);
  const longitude = Number(plant.longitude);

  const gpsText =
    Number.isFinite(latitude) && Number.isFinite(longitude)
      ? latitude.toFixed(6) + ', ' + longitude.toFixed(6)
      : 'Not recorded';

  const details = document.createElement('div');

  details.style.minWidth = '230px';

  details.innerHTML = `
    <h3 style="margin:0 0 10px">
      ${escapePopupText(scientificName)}
    </h3>

    <p><strong>Common name:</strong>
      ${escapePopupText(commonName)}</p>

    <p><strong>Plant tag:</strong>
      ${escapePopupText(plant.tag || 'No tag')}</p>

    <p><strong>Conservation status:</strong>
      ${escapePopupText(conservationStatus)}</p>

    <p><strong>Plant status:</strong>
      ${escapePopupText(plant.status || 'Not recorded')}</p>

    <p><strong>Location:</strong>
      ${escapePopupText(plant.landmark || 'Not recorded')}</p>

    <p><strong>GPS:</strong>
      ${escapePopupText(gpsText)}</p>

    <p><strong>Last visit:</strong>
      ${escapePopupText(displayVisitDate(plant.last_visit))}</p>
  `;

  if (plant.id) {
    const button = document.createElement('button');

    button.className = 'btn';
    button.textContent = 'Edit Plant';
    button.style.marginTop = '10px';

    button.addEventListener('click', () => {
      // Use the same URL format as your existing
      // plant catalogue's Edit button.
      window.location.href =
        'editor.html?plant_id=' + encodeURIComponent(plant.id);
    });

    details.appendChild(button);
  }

  return details;
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

function normalizeConservationStatus(value) {
  const status = String(value || '').trim().toUpperCase();

  const statuses = {
    'CR': 'CR',
    'CRITICALLY ENDANGERED': 'CR',
    'EN': 'EN',
    'ENDANGERED': 'EN',
    'VU': 'VU',
    'VULNERABLE': 'VU',
    'NT': 'NT',
    'NEAR THREATENED': 'NT',
    'LC': 'LC',
    'LEAST CONCERN': 'LC',
    'DD': 'DD',
    'DATA DEFICIENT': 'DD'
  };

  return statuses[status] || status;
}

function getMarkerColor(status) {
  const colors = {
    CR: '#dc2626', // Red
    EN: '#f97316', // Orange
    VU: '#eab308', // Yellow
    NT: '#3b82f6', // Blue
    LC: '#22c55e', // Green
    DD: '#6b7280'  // Grey
  };

  return colors[status] || '#6b7280';
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
    const conservationStatus = plant.species
      ? plant.species.conservation_status
      : '';

    if (chosenSpecies && speciesId !== chosenSpecies) {
      return;
    }

    if (
      chosenStatus &&
      normalizeConservationStatus(conservationStatus) !==
      normalizeConservationStatus(chosenStatus)
    ) {
      return;
    }

    // Check GPS coordinates.
    if (
      plant.latitude === null ||
      plant.latitude === undefined ||
      plant.latitude === '' ||
      plant.longitude === null ||
      plant.longitude === undefined ||
      plant.longitude === ''
    ) {
      return;
    }

    const latitude = Number(plant.latitude);
    const longitude = Number(plant.longitude);

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return;
    }

    const point = [latitude, longitude];

    // Get conservation status from the plant's species.
    const status = plant.species?.conservation_status || 'DD';

    const markerColor = getMarkerColor(
      normalizeConservationStatus(status)
    );

    L.circleMarker(point, {
      radius: 8,
      color: '#ffffff',
      weight: 2,
      fillColor: markerColor,
      fillOpacity: 0.9
    })
    .bindPopup(makePopup(plant))
    .addTo(markerLayer);

    points.push(point);
  });

  document.getElementById('map-message').textContent =
    'Showing ' + points.length + ' plant' +
    (points.length === 1 ? '' : 's') + ' on the map.';

  if (zoomToFit && points.length > 0) {
    map.fitBounds(L.latLngBounds(points), {
      padding: [50, 50],
      maxZoom: 16
    });
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

document.getElementById('map-species').addEventListener('change', function () {
  drawMarkers(true);
});

document.getElementById('map-status').addEventListener('change', function () {
  drawMarkers(true);
});

if (typeof L === 'undefined') {
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
