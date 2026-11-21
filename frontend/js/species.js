// species.js - the Species catalogue page. Every plant species is shown as a card with a big photo.
// The species come from the real species table (/api/knowledge), the same one the mobile app reads.
// Officers see every approved and archived species and the botanists' proposals; botanists see
// the approved species and can propose a new one.

drawMenu('species.html');

const viewer = getCurrentUser();
const viewerIsOfficer = viewer !== null && isBotanist(viewer) === false;

let speciesList = [];   // the species shown in the grid, as the backend sent them
let plantCountsBySpecies = new Map();
let plantCountsLoaded = false;

// Makes the big photo box of a card. The status pill sits on the photo.
// The photo link is asked for after the card is drawn (the links last one minute).
function makePlantPhoto(species) {
  const photoArea = document.createElement('div');
  photoArea.className = 'plant-photo-area';
  const box = document.createElement('div');
  box.className = 'plant-photo';

  const img = document.createElement('img');
  img.alt = species.scientific_name;
  img.loading = 'lazy';
  img.decoding = 'async';
  // A broken picture link shows the blank leaf instead.
  img.onerror = function () {
    img.onerror = null;
    img.src = PICTURE_BLANK;
  };
  img.src = PICTURE_BLANK;
  // Only approved species have photo links (the botanists' list holds approved species only).
  if (species.verification_status === 'approved' || viewerIsOfficer === false) {
    speciesPhoto(species).then(function (photo) {
      if (photo?.url) {
        // No credit on catalogue cards: it is on the editor and the Photo credits page.
        img.src = photo.url;
      }
    }).catch(function () {
      // No photo link: the blank leaf stays.
    });
  }
  box.appendChild(img);

  box.appendChild(makePill(statusLabel(species.conservation_status)));
  photoArea.appendChild(box);
  return photoArea;
}

// The family of a species (from its taxonomy row), or ''.
function familyOf(species) {
  return species.taxonomy && species.taxonomy.family ? species.taxonomy.family : '';
}

// Makes the text under the photo: the common name, the scientific name, the family and local name.
function makePlantInfo(species) {
  const info = document.createElement('div');
  info.className = 'plant-info';

  // Plants without a common name show their scientific name as the main title.
  const name = document.createElement('div');
  name.className = 'plant-name';
  name.textContent = species.common_name || species.scientific_name;
  if (!species.common_name) {
    name.classList.add('latin');
  }
  info.appendChild(name);

  if (species.common_name) {
    const scientific = document.createElement('div');
    scientific.className = 'plant-sci';
    scientific.textContent = species.scientific_name;
    info.appendChild(scientific);
  }

  const details = [];
  if (familyOf(species)) {
    details.push(familyOf(species));
  }
  if (species.local_name) {
    details.push(species.local_name);
  }
  if (species.verification_status === 'archived') {
    details.push('Archived: hidden from the mobile app');
  }
  if (details.length > 0) {
    const place = document.createElement('div');
    place.className = 'plant-place';
    place.textContent = details.join(' · ');
    place.title = place.textContent;
    info.appendChild(place);
  }
  return info;
}

// Makes one card for one species.
function makePlantCard(species) {
  const card = document.createElement('div');
  card.className = 'plant-card';

  card.appendChild(makePlantPhoto(species));
  card.appendChild(makePlantInfo(species));

  // Botanists can't change the catalogue (they propose new species instead).
  if (viewerIsOfficer === false) {
    card.style.cursor = 'default';
    return card;
  }

  card.onclick = function () {
    openSpeciesEditor(species.id);
  };

  const editButton = document.createElement('button');
  editButton.className = 'btn ghost';
  editButton.textContent = 'Edit';
  editButton.onclick = function (event) {
    event.stopPropagation();
    openSpeciesEditor(species.id);
  };

  const buttons = document.createElement('div');
  buttons.className = 'plant-actions';
  const viewPlants = document.createElement('a');
  viewPlants.className = 'btn ghost';
  viewPlants.href = 'plants.html?species=' + encodeURIComponent(species.id);
  viewPlants.textContent = plantCountsLoaded
    ? 'View plants (' + (plantCountsBySpecies.get(species.id) || 0) + ')'
    : 'View plants';
  viewPlants.onclick = function (event) {
    event.stopPropagation();
  };
  buttons.appendChild(viewPlants);
  buttons.appendChild(editButton);

  if (species.verification_status === 'approved') {
    const archiveButton = document.createElement('button');
    archiveButton.className = 'btn ghost';
    archiveButton.textContent = 'Archive';
    archiveButton.onclick = function (event) {
      event.stopPropagation();
      archiveSpecies(species).catch(showUnexpectedError);
    };
    buttons.appendChild(archiveButton);
  }

  card.appendChild(buttons);
  return card;
}

// Draws the cards again, showing only the species that match the search box and the status filter.
function drawSpeciesTable() {
  const searchInput = document.getElementById('search-box');
  const statusFilter = document.getElementById('status-filter');
  const grid = document.getElementById('species-grid');
  if (grid === null) {
    return;
  }
  const searchText = searchInput ? searchInput.value.toLowerCase() : '';
  const chosenStatus = statusFilter ? statusFilter.value : '';
  grid.innerHTML = '';
  let shown = 0;

  for (let i = 0; i < speciesList.length; i++) {
    const species = speciesList[i];
    const names = (species.scientific_name + ' ' + (species.common_name || '') + ' ' +
      (species.local_name || '')).toLowerCase();

    const nameMatches = names.includes(searchText);
    const statusMatches = chosenStatus === '' || statusLabel(species.conservation_status) === chosenStatus;

    if (nameMatches && statusMatches) {
      grid.appendChild(makePlantCard(species));
      shown = shown + 1;
    }
  }

  const count = document.getElementById('species-count');
  if (count) {
    count.textContent = 'Showing ' + shown + ' of ' + speciesList.length + ' species';
  }
  const noSpecies = document.getElementById('no-species');
  if (noSpecies) {
    noSpecies.hidden = shown > 0;
  }
}

// Asks for confirmation, then archives the species. Archived species stay in the database
// (plants already recorded keep their species) but disappear from the mobile app's list.
async function archiveSpecies(species) {
  const sure = confirm('Archive ' + species.scientific_name + '? It will no longer appear in the mobile app.');
  if (sure === false) {
    return;
  }
  try {
    await api('/knowledge/species/' + species.id, { method: 'DELETE' });
  } catch (error) {
    showToast('Could not archive the species: ' + error.message);
    return;
  }
  showToast('Species archived');
  await loadSpecies();
}

// Loads the species. Officers get approved and archived ones; botanists the approved list.
async function loadSpecies() {
  try {
    if (viewerIsOfficer) {
      const all = await fetchAllPages('/knowledge/species/manage');
      // Pending and rejected species are handled on the officer proposal page.
      speciesList = all.filter(function (species) {
        return species.verification_status === 'approved' || species.verification_status === 'archived';
      });
    } else {
      speciesList = await fetchAllPages('/knowledge/species');
    }
  } catch (error) {
    speciesList = [];
    const grid = document.getElementById('species-grid');
    if (grid) {
      grid.innerHTML = '';
    }
    const noSpecies = document.getElementById('no-species');
    if (noSpecies) {
      noSpecies.hidden = true;
    }
    const count = document.getElementById('species-count');
    if (count) {
      count.textContent = 'Could not load the species: ' + error.message;
    }
    return;
  }
  drawSpeciesTable();
}

async function loadPlantCounts() {
  try {
    const result = await api('/officer/plants/facets');
    if (!Array.isArray(result?.data?.species_counts)) {
      throw new Error('The plant counts response was invalid.');
    }
    plantCountsBySpecies = new Map(
      result.data.species_counts.map(item => [item.species_id, item.count])
    );
    plantCountsLoaded = true;
    drawSpeciesTable();
  } catch (error) {
    showToast('Plant counts could not be loaded. ' + error.message);
  }
}

// Botanists propose instead of adding.
if (viewerIsOfficer === false) {
  const addButton = document.getElementById('add-species');
  if (addButton) {
    addButton.textContent = 'Propose a species';
  }
}

loadSpecies().catch(showUnexpectedError);
if (viewerIsOfficer) {
  loadPlantCounts().catch(showUnexpectedError);
}
