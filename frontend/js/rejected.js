// rejected.js - the Rejected observations page.
// Shows the field observations an officer sent back (real data, from
// GET /api/officer/reviews/rejected), with the reason given. It is read-only: the
// botanist fixes the observation and resubmits it from the mobile app, and it then
// returns to the Observation approval queue.

drawMenu('rejected.html');

let rejected = [];
let selectedId = null;

// Makes one small card for the list on the left.
function makeListCard(observation) {
  return makeObservationListCard(observation, observation.id === selectedId, PICTURE_BLANK, function () {
    selectedId = observation.id;
    drawRejected();
  });
}

// Makes the big card on the right with the details and the reason.
function makeDetailCard(observation) {
  const card = makeObservationDetailCard(observation);

  addInfo(card, 'Reason for rejection', observation.rejection_comment || 'No reason recorded');
  if (observation.rejected_at) {
    addInfo(card, 'Rejected on', visitTime(observation.rejected_at));
  }
  addPlantAndRecorder(card, observation);
  addInfo(card, 'Notes', observation.notes || 'No notes');
  addInfo(card, 'What happens next', 'The botanist needs to fix the observation and submit it again. It then comes back to the Observation approval queue.');

  return card;
}

// Draws the whole page: the count, the list on the left and the details on the right.
function drawRejected() {
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
    rejected.length + ' rejected ' + word + ', waiting for the botanist to fix and resubmit.';

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

// Loads the rejected observations from the backend.
async function loadRejected() {
  document.getElementById('rejected-count').textContent = 'Loading rejected observations...';
  try {
    const result = await api('/officer/reviews/rejected');
    rejected = result.data || [];
  } catch (error) {
    rejected = [];
    document.getElementById('rejected-area').hidden = true;
    document.getElementById('rejected-empty').hidden = true;
    document.getElementById('rejected-count').textContent = 'Could not load rejected observations: ' + error.message;
    return;
  }
  drawRejected();
}

loadRejected().catch(showUnexpectedError);
