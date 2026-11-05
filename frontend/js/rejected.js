// rejected.js - the Rejected observations page.
// It collects every observation rejected in the Observation approval queue,
// so an officer can send a wrongly rejected one back for evaluation.

drawMenu('rejected.html');

let selectedId = null;

// Returns only the observations that were rejected.
function getRejected() {
  const all = getObservations();
  const rejected = [];
  for (let i = 0; i < all.length; i++) {
    if (all[i].state === 'Rejected') {
      rejected.push(all[i]);
    }
  }
  return rejected;
}

// Returns the observation with this id from the list, or null if there is none.
function findObservation(list, id) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) {
      return list[i];
    }
  }
  return null;
}

// Returns the photo of an observation.
// If it has none, the photo of the same species in the catalogue is used, or the blank picture.
function observationPhoto(observation) {
  if (observation.photo) {
    return observation.photo;
  }
  const species = findByScientificName(getSpecies(), observation.sci);
  if (species !== null) {
    return species.photo;
  }
  return PICTURE_BLANK;
}

// Adds a bold title with a line of text under it to the card.
function addInfo(parent, title, text) {
  const paragraph = document.createElement('p');
  const bold = document.createElement('b');
  bold.textContent = title;
  paragraph.appendChild(bold);
  paragraph.appendChild(document.createElement('br'));
  paragraph.appendChild(document.createTextNode(text));
  parent.appendChild(paragraph);
}

// Makes one small card for the list on the left.
function makeListCard(observation) {
  const card = document.createElement('div');
  card.className = 'q';
  if (observation.id === selectedId) {
    card.classList.add('on');
  }
  card.onclick = function () {
    selectedId = observation.id;
    drawRejected();
  };

  const bold = document.createElement('b');
  const name = document.createElement('i');
  name.className = 'sci';
  name.textContent = observation.sci;
  bold.appendChild(name);

  const small = document.createElement('span');
  small.className = 'muted';
  small.textContent = observation.by + ' · ' + observation.when;

  const text = document.createElement('div');
  text.appendChild(bold);
  text.appendChild(small);

  const row = document.createElement('div');
  row.className = 'sp';
  row.appendChild(makeThumb(observationPhoto(observation), observation.sci, 'md'));
  row.appendChild(text);
  card.appendChild(row);

  return card;
}

// Makes the big card on the right with the photo, the details, the reject reason and the Evaluate again button.
function makeDetailCard(observation) {
  const card = document.createElement('div');
  card.className = 'card detail';

  const title = document.createElement('h3');
  title.style.marginTop = '0';
  const name = document.createElement('i');
  name.className = 'sci';
  name.textContent = observation.sci;
  title.appendChild(name);
  card.appendChild(title);

  const record = document.createElement('p');
  record.className = 'muted';
  record.textContent = 'Record ' + observation.id;
  card.appendChild(record);

  const picture = document.createElement('img');
  picture.className = 'obs-photo';
  picture.src = observationPhoto(observation);
  picture.alt = 'Photo of ' + observation.sci;
  card.appendChild(picture);

  const status = document.createElement('p');
  const pill = document.createElement('span');
  pill.className = 'pill e';
  pill.textContent = 'Rejected';
  status.appendChild(pill);
  card.appendChild(status);

  addInfo(card, 'Reason for rejection', observation.reason || 'No reason saved');

  if (observation.com) {
    addInfo(card, 'Common name', observation.com);
  }
  if (observation.fam) {
    addInfo(card, 'Family', observation.fam);
  }
  addInfo(card, 'Location', observation.loc + ' · ' + prettyGps(observation.gps));
  addInfo(card, 'Recorded by', observation.by + ', ' + observation.when);
  addInfo(card, 'Notes', observation.notes);

  const againButton = document.createElement('button');
  againButton.className = 'btn';
  againButton.textContent = 'Evaluate again';
  againButton.onclick = function () {
    evaluateAgain(observation.id);
  };

  const buttons = document.createElement('div');
  buttons.className = 'acts';
  buttons.appendChild(againButton);
  card.appendChild(buttons);

  return card;
}

// Draws the whole page: the count, the list on the left and the details on the right.
function drawRejected() {
  const rejected = getRejected();

  if (rejected.length === 0) {
    document.getElementById('rejected-area').hidden = true;
    document.getElementById('rejected-empty').hidden = false;
    document.getElementById('rejected-count').textContent = '0 rejected observations.';
    return;
  }
  document.getElementById('rejected-area').hidden = false;
  document.getElementById('rejected-empty').hidden = true;

  let word = 'observations';
  if (rejected.length === 1) {
    word = 'observation';
  }
  document.getElementById('rejected-count').textContent =
    rejected.length + ' rejected ' + word + '. Rejected by mistake? Send it back for evaluation.';

  let selected = findObservation(rejected, selectedId);
  if (selected === null) {
    selected = rejected[0];
    selectedId = selected.id;
  }

  const listBox = document.getElementById('rejected-list');
  listBox.innerHTML = '';
  for (let i = 0; i < rejected.length; i++) {
    listBox.appendChild(makeListCard(rejected[i]));
  }

  const detailBox = document.getElementById('rejected-detail');
  detailBox.innerHTML = '';
  detailBox.appendChild(makeDetailCard(selected));
}

// Sends a rejected observation back to the Observation approval queue as "Pending".
// The old reject reason is cleared. The catalogue is not changed, because a rejected observation never touched it.
function evaluateAgain(id) {
  const observations = getObservations();
  const observation = findObservation(observations, id);
  if (observation === null) {
    return;
  }

  observation.state = 'Pending';
  observation.reason = '';
  if (writeStorage(OBSERVATIONS_KEY, observations) === false) {
    drawRejected();
    return;
  }

  selectedId = null;
  showToast('Sent back to the Observation approval queue');
  drawRejected();
}

drawRejected();
