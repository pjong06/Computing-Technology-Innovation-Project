// queue.js - the Observation approval queue page.

drawMenu('queue.html');

let selectedId = null;

// Returns only the observations that are still waiting for a decision.
function getPending() {
  const all = getObservations();
  const pending = [];
  for (let i = 0; i < all.length; i++) {
    if (all[i].state === 'Pending') {
      pending.push(all[i]);
    }
  }
  return pending;
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

// Says what will happen to the catalogue if this observation is approved:
// "new-species" = the species is not in the catalogue.
// "new-location" = the species is in the catalogue, but not at this place.
// "duplicate" = the species is already in the catalogue at this place.
// "edit" = a botanist's change to a record that is in the catalogue (see findEditTarget).
function approvalOutcome(observation) {
  const list = getSpecies();
  if (observation.kind === 'edit' && findEditTarget(list, observation) !== -1) {
    return 'edit';
  }
  let speciesIsKnown = false;

  for (let i = 0; i < list.length; i++) {
    if (sameText(list[i].sci, observation.sci)) {
      speciesIsKnown = true;
      if (samePlace(list[i], observation)) {
        return 'duplicate';
      }
    }
  }

  if (speciesIsKnown) {
    return 'new-location';
  }
  return 'new-species';
}

// Returns the position of the catalogue record a botanist's edit is about, or -1 if it is gone.
// The record is found by the scientific name and place it had when the botanist opened it.
function findEditTarget(list, observation) {
  const original = { gps: observation.origGps, loc: observation.origLoc };
  for (let i = 0; i < list.length; i++) {
    if (sameText(list[i].sci, observation.origSci) && samePlace(list[i], original)) {
      return i;
    }
  }
  return -1;
}

// Returns a list of the changes a botanist made, like "Common name: Old -> New".
function changesList(observation) {
  const list = getSpecies();
  const index = findEditTarget(list, observation);
  const changes = [];
  if (index === -1) {
    return changes;
  }
  const old = list[index];
  const fields = [
    ['Scientific name', old.sci, observation.sci],
    ['Common name', old.com, observation.com],
    ['Family', old.fam, observation.fam],
    ['Conservation status', old.status, observation.status],
    ['Location', old.loc, observation.loc],
    ['GPS', old.gps, observation.gps],
    ['Description', old.desc, observation.notes]
  ];
  for (let i = 0; i < fields.length; i++) {
    if (fields[i][1] !== fields[i][2]) {
      changes.push(fields[i][0] + ': ' + fields[i][1] + ' -> ' + fields[i][2]);
    }
  }
  if (observation.photo !== old.photo) {
    changes.push('Photo: changed');
  }
  return changes;
}

// Returns the sentence that tells the officer what Approve will do.
function outcomeText(outcome) {
  if (outcome === 'edit') {
    return 'A botanist asked to change this record. Approve to update it in the Species catalogue.';
  }
  if (outcome === 'new-species') {
    return 'This species is not in the Species catalogue yet. Choose its conservation status below, then Approve to add it.';
  }
  if (outcome === 'new-location') {
    return 'This species is already in the catalogue. A record for this new location will be added.';
  }
  return 'This species is already recorded at this location. Nothing new will be added.';
}

// Builds the new Species catalogue record from an approved observation.
// status is chosen by the officer. A species already in the catalogue keeps its own details.
function makeCatalogueRecord(observation, outcome, status) {
  const now = new Date();

  const record = {
    sci: observation.sci,
    com: '',
    fam: '',
    status: status,
    loc: observation.loc,
    gps: observation.gps,
    desc: observation.notes,
    photo: observationPhoto(observation),
    date: isoDate(now),
    when: whenText(now),
    firstDate: observation.date,
    firstWhen: observation.when,
    obsId: observation.id
  };

  if (observation.com) {
    record.com = observation.com;
  }
  if (observation.fam) {
    record.fam = observation.fam;
  }

  if (outcome === 'new-location') {
    const known = findByScientificName(getSpecies(), observation.sci);
    record.sci = known.sci;
    record.com = known.com;
    record.fam = known.fam;
    record.status = known.status;
    record.desc = known.desc;
  }
  return record;
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
    drawQueue();
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

// Makes the big card on the right with the photo, the details and the Approve and Reject buttons.
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

  if (observation.com) {
    addInfo(card, 'Common name', observation.com);
  }
  if (observation.fam) {
    addInfo(card, 'Family', observation.fam);
  }
  addInfo(card, 'Location', observation.loc + ' · ' + prettyGps(observation.gps));
  addInfo(card, 'Recorded by', observation.by + ', ' + observation.when);
  if (observation.kind === 'edit') {
    const changes = changesList(observation);
    if (changes.length === 0) {
      addInfo(card, 'Requested changes', 'No changes found (the record may have been removed).');
    } else {
      addInfo(card, 'Requested changes', changes.join('\n'));
    }
  }
  addInfo(card, 'Notes', observation.notes);
  addInfo(card, 'If approved', outcomeText(approvalOutcome(observation)));

  if (approvalOutcome(observation) === 'new-species') {
    const label = document.createElement('p');
    const bold = document.createElement('b');
    bold.textContent = 'Conservation status (required)';
    label.appendChild(bold);
    card.appendChild(label);

    const select = document.createElement('select');
    select.id = 'status-choice';
    const choices = ['', 'Endangered', 'Vulnerable', 'Least Concern'];
    for (let i = 0; i < choices.length; i++) {
      const option = document.createElement('option');
      option.value = choices[i];
      if (choices[i] === '') {
        option.textContent = 'Choose a status...';
      } else {
        option.textContent = choices[i];
      }
      select.appendChild(option);
    }
    if (observation.status) {
      select.value = observation.status;
    }
    card.appendChild(select);
  }

  const approveButton = document.createElement('button');
  approveButton.className = 'btn';
  approveButton.textContent = 'Approve';
  approveButton.onclick = function () {
    reviewObservation(observation.id, 'Approved');
  };

  const rejectButton = document.createElement('button');
  rejectButton.className = 'btn red';
  rejectButton.textContent = 'Reject';
  rejectButton.onclick = function () {
    reviewObservation(observation.id, 'Rejected');
  };

  const buttons = document.createElement('div');
  buttons.className = 'acts';
  buttons.appendChild(approveButton);
  buttons.appendChild(rejectButton);
  card.appendChild(buttons);

  return card;
}

// Draws the whole page: the count, the list on the left and the details on the right.
function drawQueue() {
  const pending = getPending();

  if (pending.length === 0) {
    document.getElementById('queue-area').hidden = true;
    document.getElementById('queue-empty').hidden = false;
    document.getElementById('queue-count').textContent = '0 field observations waiting for review.';
    return;
  }
  document.getElementById('queue-area').hidden = false;
  document.getElementById('queue-empty').hidden = true;

  let word = 'observations';
  if (pending.length === 1) {
    word = 'observation';
  }
  document.getElementById('queue-count').textContent =
    pending.length + ' field ' + word + ' waiting for review.';

  let selected = findObservation(pending, selectedId);
  if (selected === null) {
    selected = pending[0];
    selectedId = selected.id;
  }

  const listBox = document.getElementById('queue-list');
  listBox.innerHTML = '';
  for (let i = 0; i < pending.length; i++) {
    listBox.appendChild(makeListCard(pending[i]));
  }

  const detailBox = document.getElementById('queue-detail');
  detailBox.innerHTML = '';
  detailBox.appendChild(makeDetailCard(selected));
}

// Asks the officer why the observation is rejected. Returns the reason, or null if no reason was given.
function askRejectReason() {
  const typed = prompt('Why are you rejecting this observation? (saved with the record)');
  if (typed === null) {
    return null;
  }
  const reason = typed.trim();
  if (reason === '') {
    showToast('Please type a reason');
    return null;
  }
  return reason;
}

// Updates the catalogue for an approved observation. Returns the message to show, or null if it could not be saved.
// A species that is already recorded at this place is not added again, only its Last updated is refreshed.
function updateCatalogue(observation, outcome, status) {
  const speciesList = getSpecies();

  if (outcome === 'edit') {
    const index = findEditTarget(speciesList, observation);
    const old = speciesList[index];
    const now = new Date();
    speciesList[index] = {
      sci: observation.sci, com: observation.com, fam: observation.fam,
      status: observation.status, loc: observation.loc, gps: observation.gps,
      desc: observation.notes, photo: observationPhoto(observation),
      date: isoDate(now), when: whenText(now),
      firstDate: old.firstDate, firstWhen: old.firstWhen, obsId: old.obsId || ''
    };
    if (writeStorage(SPECIES_KEY, speciesList) === false) {
      return null;
    }
    return 'Approved: species record updated';
  }

  if (outcome === 'duplicate') {
    for (let i = 0; i < speciesList.length; i++) {
      if (sameText(speciesList[i].sci, observation.sci) && samePlace(speciesList[i], observation)) {
        const now = new Date();
        speciesList[i].date = isoDate(now);
        speciesList[i].when = whenText(now);
      }
    }
    if (writeStorage(SPECIES_KEY, speciesList) === false) {
      return null;
    }
    return 'Approved: already in the catalogue (Last updated refreshed)';
  }

  speciesList.push(makeCatalogueRecord(observation, outcome, status));
  if (writeStorage(SPECIES_KEY, speciesList) === false) {
    return null;
  }

  if (outcome === 'new-species') {
    return 'Approved: new species added to the catalogue';
  }
  return 'Approved: new location added to the catalogue';
}

// Approves or rejects an observation. result is "Approved" or "Rejected".
// Approve adds the plant to the Species catalogue. A new species needs a conservation status first.
// Reject needs a typed reason and does not change the catalogue.
function reviewObservation(id, result) {
  const observations = getObservations();
  const observation = findObservation(observations, id);
  let reason = '';
  let message = 'Observation rejected';

  if (result === 'Rejected') {
    reason = askRejectReason();
    if (reason === null) {
      return;
    }
  }

  if (result === 'Approved') {
    const outcome = approvalOutcome(observation);
    let chosenStatus = '';
    if (outcome === 'new-species') {
      chosenStatus = document.getElementById('status-choice').value;
      if (chosenStatus === '') {
        showToast('Choose a conservation status first');
        return;
      }
    }
    message = updateCatalogue(observation, outcome, chosenStatus);
    if (message === null) {
      drawQueue();   // the catalogue could not be saved, so nothing was approved
      return;
    }
  }

  observation.state = result;
  observation.reason = reason;
  if (writeStorage(OBSERVATIONS_KEY, observations) === false) {
    drawQueue();
    return;
  }

  showToast(message);
  drawQueue();
}

drawQueue();
