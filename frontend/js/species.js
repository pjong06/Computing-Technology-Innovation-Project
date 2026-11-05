// species.js - the Species catalogue page. Every plant is shown as a card with a big photo.

drawMenu('species.html');

// Makes the big photo box of a card. The status pill sits on the photo.
function makePlantPhoto(species) {
  const box = document.createElement('div');
  box.className = 'plant-photo';

  const img = document.createElement('img');
  img.alt = species.sci;
  img.loading = 'lazy';
  img.decoding = 'async';
  // A broken picture link shows the blank leaf instead.
  img.onerror = function () {
    img.onerror = null;
    img.src = PICTURE_BLANK;
  };
  img.src = species.photo;
  box.appendChild(img);

  box.appendChild(makePill(species.status));
  return box;
}

// Makes the text under the photo: the common name, the scientific name, and the family and place.
function makePlantInfo(species) {
  const info = document.createElement('div');
  info.className = 'plant-info';

  // Plants without a common name show their scientific name as the main title.
  const name = document.createElement('div');
  name.className = 'plant-name';
  name.textContent = species.com || species.sci;
  if (!species.com) {
    name.classList.add('latin');
  }
  info.appendChild(name);

  if (species.com) {
    const scientific = document.createElement('div');
    scientific.className = 'plant-sci';
    scientific.textContent = species.sci;
    info.appendChild(scientific);
  }

  const details = [];
  if (species.fam) {
    details.push(species.fam);
  }
  if (species.loc) {
    details.push(species.loc);
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

// Makes one card for one species. index is its position in the saved list.
function makePlantCard(species, index) {
  const card = document.createElement('div');
  card.className = 'plant-card';

  card.onclick = function () {
    openEditorFor(index);
  };

  card.appendChild(makePlantPhoto(species));
  card.appendChild(makePlantInfo(species));

  const editButton = document.createElement('button');
  editButton.className = 'btn ghost';
  editButton.textContent = 'Edit';
  editButton.onclick = function (event) {
    event.stopPropagation();
    openEditorFor(index);
  };

  const buttons = document.createElement('div');
  buttons.className = 'plant-actions';
  buttons.appendChild(editButton);

  // Botanists cannot delete records. Only officers can.
  const viewer = getCurrentUser();
  if (viewer !== null && isBotanist(viewer) === false) {
    const deleteButton = document.createElement('button');
    deleteButton.className = 'btn ghost';
    deleteButton.textContent = 'Delete';
    deleteButton.onclick = function (event) {
      event.stopPropagation();
      deleteSpecies(index);
    };
    buttons.appendChild(deleteButton);
  }

  card.appendChild(buttons);
  return card;
}

// Draws the cards again, showing only the species that match the search box and the status filter.
function drawSpeciesTable() {
  const searchText = document.getElementById('search-box').value.toLowerCase();
  const chosenStatus = document.getElementById('status-filter').value;
  const list = getSpecies();
  const grid = document.getElementById('species-grid');
  grid.innerHTML = '';
  let shown = 0;

  for (let i = 0; i < list.length; i++) {
    const species = list[i];
    const names = (species.sci + ' ' + species.com).toLowerCase();

    const nameMatches = names.includes(searchText);
    let statusMatches = false;
    if (chosenStatus === '' || species.status === chosenStatus) {
      statusMatches = true;
    }

    if (nameMatches && statusMatches) {
      grid.appendChild(makePlantCard(species, i));
      shown = shown + 1;
    }
  }

  document.getElementById('species-count').textContent = 'Showing ' + shown + ' of ' + list.length + ' plants';
  document.getElementById('no-species').hidden = (shown > 0);
}

// Asks for confirmation, then deletes the species at this position and redraws the cards.
function deleteSpecies(index) {
  const sure = confirm('Delete this species record?');
  if (sure === false) {
    return;
  }
  const list = getSpecies();
  list.splice(index, 1);
  writeStorage(SPECIES_KEY, list);
  showToast('Species deleted');
  drawSpeciesTable();
}

drawSpeciesTable();
