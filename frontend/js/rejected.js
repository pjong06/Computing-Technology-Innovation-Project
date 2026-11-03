// rejected.js - the Rejected observations page.
// Shows the field observations an officer sent back (real data, from
// GET /api/officer/reviews/rejected), with the reason given. It is read-only: the
// botanist fixes the observation and resubmits it from the mobile app, and it then
// returns to the Observation approval queue.

drawMenu('rejected.html');

let rejected = [];
let selectedId = null;

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
    drawRejected();
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
  row.appendChild(makeThumb(PICTURE_BLANK, observationName(observation), 'md'));
  row.appendChild(text);
  card.appendChild(row);
  return card;
}

// Makes the big card on the right with the details and the reason.
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

  addInfo(card, 'Reason for rejection', observation.rejection_comment || 'No reason recorded');
  if (observation.rejected_at) {
    addInfo(card, 'Rejected on', visitTime(observation.rejected_at));
  }
  if (plant.common_name) {
    addInfo(card, 'Common name', plant.common_name);
  }
  addInfo(card, 'Location', plant.location_description || 'Not recorded');
  addInfo(card, 'Recorded by', (observation.observer_name || 'Botanist') + ', ' + visitTime(observation.observed_at));
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

loadRejected();
