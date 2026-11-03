// queue.js - the Observation approval queue page.
// Shows the field observations botanists submitted from the mobile app (real data, from
// GET /api/officer/reviews/pending) and saves the officer's decision with
// POST /api/officer/reviews/:id/decision. Approved observations then show on the public
// plant pages; rejected ones are listed on the Rejected page with the reason.

drawMenu('queue.html');

let pending = [];      // the observations waiting for review, as the backend sent them
let selectedId = null;
let photosById = {};   // short-lived photo links for each observation, once loaded
let busy = false;      // a decision is being saved

// Returns the observation with this id from the list, or null if there is none.
function findObservation(list, id) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) {
      return list[i];
    }
  }
  return null;
}

// The name to show: the plant's scientific name, or a plain fallback.
function observationName(observation) {
  if (observation.plant && observation.plant.scientific_name) {
    return observation.plant.scientific_name;
  }
  return 'Species not recorded';
}

// "2 Nov 2026, 11:00 AM" for an ISO date, or '' when there is none.
function visitTime(iso) {
  if (!iso) {
    return '';
  }
  return whenText(new Date(iso));
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
  name.textContent = observationName(observation);
  bold.appendChild(name);

  const small = document.createElement('span');
  small.className = 'muted';
  small.textContent = (observation.observer_name || 'Botanist') + ' · ' + visitTime(observation.observed_at);

  const text = document.createElement('div');
  text.appendChild(bold);
  text.appendChild(small);

  const row = document.createElement('div');
  row.className = 'sp';
  const photos = photosById[observation.id];
  const firstPhoto = photos && photos.length > 0 && photos[0].url ? photos[0].url : PICTURE_BLANK;
  row.appendChild(makeThumb(firstPhoto, observationName(observation), 'md'));
  row.appendChild(text);
  card.appendChild(row);
  return card;
}

// Makes the big card on the right with the photos, the details and the buttons.
function makeDetailCard(observation) {
  const card = document.createElement('div');
  card.className = 'card detail';

  const title = document.createElement('h3');
  title.style.marginTop = '0';
  const name = document.createElement('i');
  name.className = 'sci';
  name.textContent = observationName(observation);
  title.appendChild(name);
  card.appendChild(title);

  const plant = observation.plant || {};
  const record = document.createElement('p');
  record.className = 'muted';
  record.textContent = plant.tag_code ? 'Tag ' + plant.tag_code : 'No tag attached';
  card.appendChild(record);

  // Photos: loaded when the observation is opened (the links last one minute).
  const photos = photosById[observation.id];
  if (photos === undefined) {
    const loading = document.createElement('p');
    loading.className = 'muted';
    loading.textContent = 'Loading photos...';
    card.appendChild(loading);
  } else if (photos === null) {
    const failed = document.createElement('p');
    failed.className = 'muted';
    failed.textContent = 'The photos could not be loaded.';
    card.appendChild(failed);
  } else if (photos.length === 0) {
    const none = document.createElement('p');
    none.className = 'muted';
    none.textContent = 'No photos with this observation.';
    card.appendChild(none);
  } else {
    for (let i = 0; i < photos.length; i++) {
      if (!photos[i].url) {
        continue;
      }
      const picture = document.createElement('img');
      picture.className = 'obs-photo';
      picture.src = photos[i].url;
      picture.alt = photos[i].caption || ('Photo of ' + observationName(observation));
      card.appendChild(picture);
    }
  }

  if (plant.common_name) {
    addInfo(card, 'Common name', plant.common_name);
  }
  addInfo(card, 'Location', plant.location_description || 'Not recorded');
  addInfo(card, 'Recorded by', (observation.observer_name || 'Botanist') + ', ' + visitTime(observation.observed_at));
  if (observation.health_status) {
    addInfo(card, 'Health', observation.health_status);
  }
  if (observation.life_stage) {
    addInfo(card, 'Stage', observation.life_stage);
  }
  const sizes = [];
  if (observation.height_cm !== null && observation.height_cm !== undefined) {
    sizes.push('Height ' + observation.height_cm + ' cm');
  }
  if (observation.diameter_cm !== null && observation.diameter_cm !== undefined) {
    sizes.push('Diameter ' + observation.diameter_cm + ' cm');
  }
  if (sizes.length > 0) {
    addInfo(card, 'Measurements', sizes.join(' · '));
  }
  addInfo(card, 'Notes', observation.notes || 'No notes');

  const approveButton = document.createElement('button');
  approveButton.className = 'btn';
  approveButton.textContent = 'Approve';
  approveButton.disabled = busy;
  approveButton.onclick = function () {
    reviewObservation(observation.id, 'approved');
  };

  const rejectButton = document.createElement('button');
  rejectButton.className = 'btn red';
  rejectButton.textContent = 'Reject';
  rejectButton.disabled = busy;
  rejectButton.onclick = function () {
    reviewObservation(observation.id, 'rejected');
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
  loadPhotos(selected.id);

  const listBox = document.getElementById('queue-list');
  listBox.innerHTML = '';
  for (let i = 0; i < pending.length; i++) {
    listBox.appendChild(makeListCard(pending[i]));
  }

  const detailBox = document.getElementById('queue-detail');
  detailBox.innerHTML = '';
  detailBox.appendChild(makeDetailCard(selected));
}

// Loads the photo links of one observation once, then redraws.
const photosLoading = {};
async function loadPhotos(id) {
  if (photosById[id] !== undefined || photosLoading[id]) {
    return;
  }
  photosLoading[id] = true;
  try {
    const result = await api('/officer/reviews/' + id + '/photos');
    photosById[id] = result.data || [];
  } catch (error) {
    photosById[id] = null;
  }
  delete photosLoading[id];
  if (findObservation(pending, id) !== null) {
    drawQueue();
  }
}

// Asks the officer why the observation is rejected. Returns the reason, or null if no reason was given.
function askRejectReason() {
  const typed = prompt('Why are you rejecting this observation? (saved with the review)');
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

// Saves the officer's decision, then reloads the queue.
async function reviewObservation(id, decision) {
  if (busy) {
    return;
  }
  let comments = null;
  if (decision === 'rejected') {
    comments = askRejectReason();
    if (comments === null) {
      return;
    }
  }

  busy = true;
  drawQueue();
  try {
    await api('/officer/reviews/' + id + '/decision', {
      method: 'POST',
      body: JSON.stringify({ decision: decision, comments: comments }),
    });
    showToast(decision === 'approved' ? 'Observation approved' : 'Observation rejected');
    delete photosById[id];
  } catch (error) {
    // e.g. "Observation must be Pending; approval requires an approved species"
    showToast(error.message);
  }
  busy = false;
  await loadQueue();
}

// Loads the waiting observations from the backend.
async function loadQueue() {
  document.getElementById('queue-count').textContent = 'Loading observations...';
  try {
    const result = await api('/officer/reviews/pending');
    pending = result.data || [];
  } catch (error) {
    pending = [];
    document.getElementById('queue-area').hidden = true;
    document.getElementById('queue-empty').hidden = true;
    document.getElementById('queue-count').textContent = 'Could not load the queue: ' + error.message;
    return;
  }
  drawQueue();
}

loadQueue();
