// map.js - the Distribution map page.

drawMenu('map.html');

let map = null;
let markerLayer = null;

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
    attribution: 'Labels &copy; Esri'
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

// Returns the colour of the dot for a conservation status.
function markerColor(status) {
  if (status === 'Endangered') {
    return '#c0392b';
  }
  if (status === 'Vulnerable') {
    return '#e0a800';
  }
  return '#3d8b4f';
}

// Builds the small box that opens when a dot is clicked. It has an Edit record button.
function makePopup(species, index) {
  const box = document.createElement('div');

  const title = document.createElement('b');
  title.textContent = species.sci;
  box.appendChild(title);

  const info = document.createElement('div');
  info.textContent = species.com + ' · ' + species.status;
  box.appendChild(info);

  const place = document.createElement('div');
  place.textContent = species.loc + ' (' + species.gps + ')';
  box.appendChild(place);

  const button = document.createElement('button');
  button.textContent = 'Edit record';
  button.onclick = function () {
    openEditorFor(index);
  };
  box.appendChild(button);

  return box;
}

// Checks a species against the map's search box and status filter.
function speciesPassesMapFilter(species, searchText, chosenStatus) {
  const names = (species.sci + ' ' + species.com).toLowerCase();
  if (names.includes(searchText) === false) {
    return false;
  }
  if (chosenStatus !== '' && species.status !== chosenStatus) {
    return false;
  }
  return true;
}

// Draws one dot for every species that matches the filters.
// If zoomToFit is true, the map zooms so that all the dots can be seen.
function drawMarkers(zoomToFit) {
  if (map === null) {
    return;
  }
  markerLayer.clearLayers();

  const searchText = document.getElementById('map-search').value.toLowerCase();
  const chosenStatus = document.getElementById('map-status').value;
  const list = getSpecies();
  const points = [];
  let skipped = 0;

  for (let i = 0; i < list.length; i++) {
    const species = list[i];

    if (speciesPassesMapFilter(species, searchText, chosenStatus) === false) {
      continue;
    }

    const gps = readGps(species.gps);
    if (gps === null) {
      skipped = skipped + 1;
      continue;
    }

    const dot = L.circleMarker(gps, {
      radius: 11,
      color: '#ffffff',
      weight: 2,
      fillColor: markerColor(species.status),
      fillOpacity: 0.9
    });
    dot.bindPopup(makePopup(species, i));

    if (species.loc) {
      dot.bindTooltip(species.loc, {
        permanent: true,
        direction: 'right',
        offset: [12, 0],
        className: 'loc-label'
      });
    }

    dot.addTo(markerLayer);
    points.push(gps);
  }

  let message = 'Showing ' + points.length + ' species records on the map.';
  if (skipped > 0) {
    message = message + ' ' + skipped + ' without a valid GPS location are not shown.';
  }
  document.getElementById('map-message').textContent = message;

  if (zoomToFit && points.length > 0) {
    map.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 16 });
  }
}

if (typeof L === 'undefined') {
  document.getElementById('map-message').textContent =
    'The map could not load. Check your internet connection and refresh the page.';
} else {
  createMap();
  drawMarkers(true);
}
