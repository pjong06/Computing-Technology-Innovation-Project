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
let sortOrder = SORT_NEWEST; // newest field record first; the select switches it

// Makes one small card for the list on the left, with the first photo once it is loaded.
function visitKind(observation) {
  return observation.plant?.plant_status === 'pending' ? 'New plant' : 'Revisit';
}

function visitKindBadge(observation) {
  const badge = document.createElement('span');
  badge.className = 'review-kind ' +
    (visitKind(observation) === 'New plant' ? 'new-plant' : 'revisit');
  badge.textContent = visitKind(observation);
  return badge;
}

function makeListCard(observation) {
  const photos = photosById[observation.id];
  // The list thumbnail comes with the list (signed in one batch), so no click is needed;
  // once the photos are opened, the first one is used.
  const firstPhoto = photos && photos.length > 0 && photos[0].url
    ? photos[0].url
    : observation.thumbnail_url || PICTURE_BLANK;
  const card = makeObservationListCard(observation, observation.id === selectedId, firstPhoto, function () {
    selectedId = observation.id;
    drawQueue();
  });
  card.insertBefore(visitKindBadge(observation), card.firstChild);
  return card;
}

// Makes the big card on the right with the photos, the details and the buttons.
function makeDetailCard(observation) {
  const card = makeObservationDetailCard(observation);
  addInfo(card, 'Visit type', visitKind(observation));

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

  addPlantAndRecorder(card, observation);
  if (observation.health_status) {
    addInfo(card, 'Health', observation.health_status);
  }
  if (observation.life_stage) {
    addInfo(card, 'Stage', observation.life_stage);
  }
  // Stored in cm; height is shown in metres (2 decimals), diameter in cm.
  const sizes = [];
  if (observation.height_cm !== null && observation.height_cm !== undefined) {
    sizes.push('Height ' + Math.round(Number(observation.height_cm)) / 100 + ' m');
  }
  if (observation.diameter_cm !== null && observation.diameter_cm !== undefined) {
    sizes.push('Diameter ' + Math.round(Number(observation.diameter_cm) * 100) / 100 + ' cm');
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
    reviewObservation(observation.id, 'approved').catch(showUnexpectedError);
  };

  const rejectButton = document.createElement('button');
  rejectButton.className = 'btn red';
  rejectButton.textContent = 'Reject';
  rejectButton.disabled = busy;
  rejectButton.onclick = function () {
    reviewObservation(observation.id, 'rejected').catch(showUnexpectedError);
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
    document.getElementById('queue-count').textContent = '0 field records waiting for review.';
    return;
  }
  document.getElementById('queue-area').hidden = false;
  document.getElementById('queue-empty').hidden = true;

  let word = 'records';
  if (pending.length === 1) {
    word = 'record';
  }
  document.getElementById('queue-count').textContent =
    pending.length + ' field ' + word + ' waiting for review.';

  addListSortSelect('queue-count', 'queue-sort', function (order) {
    sortOrder = order;
    drawQueue();
  });
  const ordered = sortByDate(pending, item => item.observed_at, sortOrder);

  let selected = findObservation(ordered, selectedId);
  if (selected === null) {
    selected = ordered[0];
    selectedId = selected.id;
  }
  loadPhotos(selected.id).catch(showUnexpectedError);

  const listBox = document.getElementById('queue-list');
  listBox.innerHTML = '';
  for (let i = 0; i < ordered.length; i++) {
    listBox.appendChild(makeListCard(ordered[i]));
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
    showToast(decision === 'approved' ? 'Field record approved' : 'Field record sent back (Needs changes)');
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
  // Keep the Field records and Review badges in step after every load (and so after each decision).
  refreshFieldRecordsCount().catch(error => {
    showToast('Field record count could not be loaded. ' + error.message);
  });
}

loadQueue().catch(showUnexpectedError);
