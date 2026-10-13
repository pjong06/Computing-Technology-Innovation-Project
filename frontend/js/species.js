// species.js - the Species catalogue page.

drawMenu('species.html');

// Makes a table cell that shows a date on one line and the time on the next. Shows "Not recorded" if there is none.
function makeDateCell(text) {
  const td = document.createElement('td');
  td.className = 'when';

  if (!text) {
    td.textContent = 'Not recorded';
    return td;
  }

  const parts = text.split(', ');
  td.appendChild(document.createTextNode(parts[0]));
  if (parts.length > 1) {
    td.appendChild(document.createElement('br'));
    td.appendChild(document.createTextNode(parts[1]));
  }
  return td;
}

// Makes one table row for one species. index is its position in the saved list.
function makeSpeciesRow(species, index) {
  const row = document.createElement('tr');
  row.className = 'row';

  row.onclick = function () {
    openEditorFor(index);
  };

  const names = document.createElement('div');
  const scientific = document.createElement('i');
  scientific.className = 'sci';
  scientific.textContent = species.sci;
  const common = document.createElement('div');
  common.className = 'muted';
  common.textContent = species.com;
  names.appendChild(scientific);
  names.appendChild(common);

  const box = document.createElement('div');
  box.className = 'sp';
  box.appendChild(makeThumb(species.photo, species.sci, 'big'));
  box.appendChild(names);

  const firstCell = document.createElement('td');
  firstCell.appendChild(box);
  row.appendChild(firstCell);

  row.appendChild(makeCell(species.fam));
  row.appendChild(makeCell(species.loc));

  const statusCell = document.createElement('td');
  statusCell.appendChild(makePill(species.status));
  row.appendChild(statusCell);

  row.appendChild(makeDateCell(species.firstWhen));
  row.appendChild(makeDateCell(species.when));

  const editButton = document.createElement('button');
  editButton.className = 'btn ghost';
  editButton.textContent = 'Edit';
  editButton.onclick = function (event) {
    event.stopPropagation();
    openEditorFor(index);
  };

  const deleteButton = document.createElement('button');
  deleteButton.className = 'btn ghost';
  deleteButton.textContent = 'Delete';
  deleteButton.onclick = function (event) {
    event.stopPropagation();
    deleteSpecies(index);
  };

  const buttons = document.createElement('div');
  buttons.className = 'acts';
  buttons.appendChild(editButton);
  buttons.appendChild(deleteButton);

  const buttonCell = document.createElement('td');
  buttonCell.appendChild(buttons);
  row.appendChild(buttonCell);

  return row;
}

// Draws the table again, showing only the species that match the search box and the status filter.
function drawSpeciesTable() {
  const searchText = document.getElementById('search-box').value.toLowerCase();
  const chosenStatus = document.getElementById('status-filter').value;
  const list = getSpecies();
  const body = document.getElementById('species-body');
  body.innerHTML = '';
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
      body.appendChild(makeSpeciesRow(species, i));
      shown = shown + 1;
    }
  }

  document.getElementById('no-species').hidden = (shown > 0);
}

// Asks for confirmation, then deletes the species at this position and redraws the table.
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
