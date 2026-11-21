// rejected.js - the Rejected observations page.
// Shows the field observations an officer sent back (real data, from
// GET /api/officer/reviews/rejected), with the reason given. It is read-only: the
// botanist fixes the observation and resubmits it from the mobile app, and it then
// returns to the Observation approval queue.

drawMenu('rejected.html');

let rejected = [];
let selectedId = null;
let sortOrder = SORT_NEWEST; // newest rejection first; the select switches it

// "New plant" for the plant's first record (its registration), otherwise "Observation" (the
// same rule and words as the review list). Without is_first_record, a pending plant counts as new.
function recordKind(observation) {
  if (observation.is_first_record === true) return 'New plant';
  if (observation.is_first_record === false) return 'Observation';
  return observation.plant?.plant_status === 'pending' ? 'New plant' : 'Observation';
}

function recordKindBadge(observation) {
  const badge = document.createElement('span');
  badge.className = 'review-kind ' + (recordKind(observation) === 'New plant' ? 'new-plant' : 'observation');
  badge.textContent = recordKind(observation);
  return badge;
}

// Makes one small card for the list on the left.
function makeListCard(observation) {
  // The thumbnail comes with the list (signed in one batch), so no click is needed.
  const card = makeObservationListCard(observation, observation.id === selectedId, observation.thumbnail_url || PICTURE_BLANK, function () {
    selectedId = observation.id;
    drawRejected();
  });
  card.insertBefore(recordKindBadge(observation), card.firstChild);
  // The reason is visible in the list, without opening the record.
  const reason = document.createElement('span');
  reason.className = 'list-note';
  reason.textContent = 'Reason: ' + (observation.rejection_comment || 'No reason recorded');
  reason.title = reason.textContent;
  card.appendChild(reason);
  return card;
}

// Makes the big card on the right with the details and the reason.
function makeDetailCard(observation) {
  const card = makeObservationDetailCard(observation);
  const photoSection = document.createElement('div');
  photoSection.textContent = 'Loading photos...';
  card.appendChild(photoSection);
  void loadRejectedPhotos(observation.id, photoSection);

  addInfo(card, 'Record type', recordKind(observation));
  addInfo(card, 'Reason', observation.rejection_comment || 'No reason recorded');
  if (observation.rejected_at) {
    addInfo(card, 'Sent back on', visitTime(observation.rejected_at));
  }
  addPlantAndRecorder(card, observation);
  addInfo(card, 'Notes', observation.notes || 'No notes');
  addInfo(card, 'What happens next', 'The botanist needs to fix this field record and submit it again. It then comes back to Field records to review.');

  return card;
}

async function loadRejectedPhotos(observationId, container) {
  try {
    const result = await api(`/officer/reviews/${observationId}/photos`);
    const photos = (result.data || []).filter(photo => photo.url);

    if (photos.length === 0) {
      container.textContent = 'No photos with this observation.';
      return;
    }

    container.textContent = '';
    for (const photo of photos) {
      const image = document.createElement('img');
      image.className = 'obs-photo';
      image.src = photo.url;
      image.alt = photo.caption || 'Observation photo';
      container.appendChild(image);
    }
  } catch {
    container.textContent = 'The photos could not be loaded.';
  }
}

// Draws the whole page: the count, the list on the left and the details on the right.
function drawRejected() {
  if (rejected.length === 0) {
    document.getElementById('rejected-area').hidden = true;
    document.getElementById('rejected-empty').hidden = false;
    document.getElementById('rejected-count').textContent = 'No field records need changes.';
    return;
  }
  document.getElementById('rejected-area').hidden = false;
  document.getElementById('rejected-empty').hidden = true;

  let words = 'field records that need changes';
  if (rejected.length === 1) {
    words = 'field record that needs changes';
  }
  document.getElementById('rejected-count').textContent =
    rejected.length + ' ' + words + ', waiting for the botanist to fix and resubmit.';

  addListSortSelect('rejected-count', 'rejected-sort', function (order) {
    sortOrder = order;
    drawRejected();
  });
  const ordered = sortByDate(rejected, item => item.rejected_at || item.observed_at, sortOrder);

  let selected = findObservation(ordered, selectedId);
  if (selected === null) {
    selected = ordered[0];
    selectedId = selected.id;
  }

  const listBox = document.getElementById('rejected-list');
  listBox.innerHTML = '';
  for (let i = 0; i < ordered.length; i++) {
    listBox.appendChild(makeListCard(ordered[i]));
  }

  const detailBox = document.getElementById('rejected-detail');
  detailBox.innerHTML = '';
  detailBox.appendChild(makeDetailCard(selected));
}

// Loads the rejected observations from the backend.
async function loadRejected() {
  document.getElementById('rejected-count').textContent = 'Loading field records that need changes...';
  try {
    const result = await api('/officer/reviews/rejected');
    rejected = result.data || [];
  } catch (error) {
    rejected = [];
    document.getElementById('rejected-area').hidden = true;
    document.getElementById('rejected-empty').hidden = true;
    document.getElementById('rejected-count').textContent = error.message || 'Could not load field records that need changes.';
    return;
  }
  drawRejected();
}

loadRejected().catch(showUnexpectedError);
