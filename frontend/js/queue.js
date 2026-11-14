
/* queue.js - Supabase-backed Observation Approval Queue */

drawMenu('queue.html');

let pending = [];
let selectedId = null;
let busy = false;
const photoCache = new Map();

function findObservation(list, id) {
  return list.find(item => item.id === id) || null;
}

function addInfo(parent, title, value) {
  const p = document.createElement('p');
  const b = document.createElement('b');
  b.textContent = title;
  p.appendChild(b);
  p.appendChild(document.createElement('br'));
  p.appendChild(document.createTextNode(String(value ?? '—')));
  parent.appendChild(p);
}

function plantName(observation) {
  return observation.plant?.scientific_name ||
    observation.scientific_name ||
    'Unidentified species';
}

function photoOf(observation) {
  return photoCache.get(observation.id) ||
    (typeof PICTURE_BLANK !== 'undefined' ? PICTURE_BLANK : '');
}

async function loadPhoto(observationId) {
  if (photoCache.has(observationId)) return;

  try {
    const id = encodeURIComponent(observationId);
    const result = await api(
      '/officer/reviews/' + id + '/photos'
    );

    const photos = result.data || [];
    const first = photos[0];

    if (first) {
      const url = first.signed_url ||
        first.signedUrl ||
        first.url ||
        first.photo_url;

      if (url) photoCache.set(observationId, url);
    }
  } catch (error) {
    console.warn('Photo unavailable:', error.message);
  }
}

function makeListCard(observation) {
  const card = document.createElement('div');
  card.className = 'q';

  if (observation.id === selectedId) {
    card.classList.add('on');
  }

  card.onclick = () => {
    selectedId = observation.id;
    drawQueue();
  };

  const row = document.createElement('div');
  row.className = 'sp';

  const picture = document.createElement('img');
  picture.src = photoOf(observation);
  picture.alt = 'Observation photo';
  picture.style.width = '70px';
  picture.style.height = '70px';
  picture.style.objectFit = 'cover';

  const details = document.createElement('div');

  const name = document.createElement('b');
  name.textContent = plantName(observation);

  const small = document.createElement('div');
  small.className = 'muted';
  small.textContent =
    (observation.observer_name || 'Botanist') +
    ' · ' +
    (observation.observed_at
      ? new Date(observation.observed_at).toLocaleString()
      : 'Unknown date');

  details.appendChild(name);
  details.appendChild(small);

  row.appendChild(picture);
  row.appendChild(details);
  card.appendChild(row);

  return card;
}

function makeDetailCard(observation) {
  const card = document.createElement('div');
  card.className = 'card detail';

  const title = document.createElement('h3');
  title.textContent = plantName(observation);
  card.appendChild(title);

  const picture = document.createElement('img');
  picture.className = 'obs-photo';
  picture.src = photoOf(observation);
  picture.alt = 'Observation photo';
  card.appendChild(picture);

  addInfo(card, 'Observation ID', observation.id);
  addInfo(card, 'Plant ID', observation.plant_id);
  addInfo(card, 'Scientific name', plantName(observation));
  addInfo(card, 'Common name', observation.plant?.common_name);
  addInfo(card, 'Recorded by', observation.observer_name);
  addInfo(
    card,
    'Observed at',
    observation.observed_at
      ? new Date(observation.observed_at).toLocaleString()
      : 'Unknown'
  );
  addInfo(card, 'Location', observation.plant?.location_description);
  addInfo(card, 'Health status', observation.health_status);
  addInfo(card, 'Life stage', observation.life_stage);
  addInfo(card, 'Height (cm)', observation.height_cm);
  addInfo(card, 'Diameter (cm)', observation.diameter_cm);
  addInfo(card, 'Notes', observation.notes);

  const buttons = document.createElement('div');
  buttons.className = 'acts';

  const approve = document.createElement('button');
  approve.className = 'btn';
  approve.textContent = 'Approve';
  approve.disabled = busy;
  approve.onclick = () => reviewObservation(observation.id, 'approved');

  const reject = document.createElement('button');
  reject.className = 'btn red';
  reject.textContent = 'Reject';
  reject.disabled = busy;
  reject.onclick = () => reviewObservation(observation.id, 'rejected');

  buttons.appendChild(approve);
  buttons.appendChild(reject);
  card.appendChild(buttons);

  return card;
}

function drawQueue() {
  const area = document.getElementById('queue-area');
  const empty = document.getElementById('queue-empty');
  const count = document.getElementById('queue-count');
  const listBox = document.getElementById('queue-list');
  const detailBox = document.getElementById('queue-detail');

  count.textContent =
    pending.length + ' field observation(s) waiting for review.';

  if (pending.length === 0) {
    area.hidden = true;
    empty.hidden = false;
    return;
  }

  area.hidden = false;
  empty.hidden = true;

  let selected = findObservation(pending, selectedId);

  if (!selected) {
    selected = pending[0];
    selectedId = selected.id;
  }

  listBox.innerHTML = '';
  detailBox.innerHTML = '';

  pending.forEach(observation => {
    listBox.appendChild(makeListCard(observation));
  });

  detailBox.appendChild(makeDetailCard(selected));
}

async function loadQueue() {
  document.getElementById('queue-count').textContent =
    'Loading pending observations...';

  try {
    const result = await api('/officer/reviews/pending');
    pending = result.data || [];

    await Promise.all(
      pending.map(item => loadPhoto(item.id))
    );

    drawQueue();
  } catch (error) {
    pending = [];

    document.getElementById('queue-area').hidden = true;
    document.getElementById('queue-empty').hidden = true;

    document.getElementById('queue-count').textContent =
      'Could not load observations: ' + error.message;
  }
}

async function reviewObservation(id, decision) {
  if (busy) return;

  const observation = findObservation(pending, id);
  if (!observation) return;

  let comments = '';

  if (decision === 'rejected') {
    const reason = prompt('Why are you rejecting this observation?');

    if (reason === null) return;

    comments = reason.trim();

    if (!comments) {
      showToast('Please enter a rejection reason.');
      return;
    }

    if (comments.length > 2000) {
      showToast('Rejection reason must be 2000 characters or less.');
      return;
    }
  } else {
    if (!confirm('Approve this field observation?')) return;
  }

  busy = true;
  drawQueue();

  try {
    await api(
      '/officer/reviews/' + id + '/decision',
      {
        method: 'POST',
        body: JSON.stringify({
          decision,
          comments
        })
      }
    );

    showToast(
      decision === 'approved'
        ? 'Observation approved successfully.'
        : 'Observation rejected successfully.'
    );

    selectedId = null;
    await loadQueue();


  } catch (error) {
    showToast('Could not save decision: ' + error.message);
    console.error('Observation review failed:', error);

  } finally {
    busy = false;
    drawQueue();
  }
}


async function loadProposals() {
  const area = document.getElementById('proposal-area');
  const list = document.getElementById('proposal-list');
  const detail = document.getElementById('proposal-detail');

  try {
    const result = await api('/knowledge/species/proposals/pending?page_size=100');
    const proposals = result.data || [];

    list.replaceChildren();
    detail.replaceChildren();
    area.hidden = proposals.length === 0;

    function showProposal(proposal) {
      detail.replaceChildren();

      const card = document.createElement('div');
      card.className = 'card';

      const heading = document.createElement('h3');
      heading.textContent = proposal.scientific_name;
      card.appendChild(heading);

      // Display the botanist's submitted photograph.
      const proposalPhoto = document.createElement('img');
      proposalPhoto.alt = 'Botanical photograph submitted for review';
      proposalPhoto.style.width = '100%';
      proposalPhoto.style.maxWidth = '420px';
      proposalPhoto.style.maxHeight = '320px';
      proposalPhoto.style.objectFit = 'contain';
      proposalPhoto.style.borderRadius = '10px';
      proposalPhoto.style.display = 'none';

      const photoMessage = document.createElement('p');
      photoMessage.textContent = 'Loading proposal photograph...';

      card.appendChild(proposalPhoto);
      card.appendChild(photoMessage);

      api(
        '/knowledge/species/proposals/' +
        encodeURIComponent(proposal.id) +
        '/photo-preview'
      )
      .then(result => {
          // Do not display a photo for a proposal that is no longer selected.
          if (!detail.contains(card)) return;

          if (!result.data?.url) {
              photoMessage.textContent = 'Photograph unavailable.';
              return;
          }

          proposalPhoto.onload = () => {
              photoMessage.hidden = true;
          };

          proposalPhoto.onerror = () => {
              proposalPhoto.style.display = 'none';
              photoMessage.textContent = 'Could not display photograph.';
          };

          proposalPhoto.src = result.data.url;
          proposalPhoto.style.display = 'block';
      })
      .catch(error => {
          if (!detail.contains(card)) return;
          photoMessage.textContent =
              'Photograph unavailable: ' + error.message;
      });

    const fields = {
    'Scientific name': proposal.scientific_name,
    'Common name': proposal.common_name,
    'Local name': proposal.local_name,
    'Family': proposal.proposed_family,
    'Habitat': proposal.habitat,
    'Description': proposal.description,
    'Conservation status': proposal.conservation_status,
    'Latitude': proposal.proposed_latitude,
    'Longitude': proposal.proposed_longitude,
    'Location description': proposal.proposed_location_description,
    'Submitted by': proposal.proposer_name
};

      for (const [label, value] of Object.entries(fields)) {
        const row = document.createElement('p');
        const strong = document.createElement('strong');
        strong.textContent = label + ': ';
        row.append(strong, document.createTextNode(value ?? '—'));
        card.appendChild(row);
      }

      for (const decision of ['approved', 'rejected']) {
        const button = document.createElement('button');
        button.className = 'btn';
        button.textContent = decision === 'approved' ? 'Approve' : 'Reject';

        button.onclick = async () => {
          let comment = null;

          if (decision === 'rejected') {
            comment = prompt('Reason for rejection:');
            if (comment === null) return;
            comment = comment.trim();
            if (!comment) return alert('Rejection reason is required.');
          } else {
            if (!confirm('Approve this species proposal?')) return;
          }

          button.disabled = true;

          try {
            await api(`/knowledge/species/proposals/${proposal.id}/review`, {
              method: 'PATCH',
              body: JSON.stringify({ decision, comment })
            });

            await loadProposals();
          } catch (error) {
            alert(error.message);
            button.disabled = false;
          }
        };

        card.appendChild(button);
      }

      detail.appendChild(card);
    }

    for (const proposal of proposals) {
      const item = document.createElement('button');
      item.className = 'btn';
      item.textContent = proposal.scientific_name;
      item.onclick = () => showProposal(proposal);
      list.appendChild(item);
    }

    if (proposals.length > 0) {
      showProposal(proposals[0]);
    }

  } catch (error) {
    console.error('Could not load species proposals:', error);
  }
}

loadProposals();


async function loadPendingPlants() {
  const list = document.getElementById("plant-review-list");
  const detail = document.getElementById("plant-review-detail");
  const count = document.getElementById("plant-review-count");

  try {
    const { data = [] } = await api("/plants/pending-review");

    count.textContent = `${data.length} Pending`;
    list.replaceChildren();
    detail.replaceChildren();

    function showPlant(plant) {
      detail.replaceChildren();

      const card = document.createElement("div");
      card.className = "card";

      const title = document.createElement("h3");
      title.textContent = plant.species?.scientific_name || "Unknown species";
      card.appendChild(title);
      if (plant.photo_url) {
        const photo = document.createElement("img");
        photo.src = plant.photo_url;
        photo.alt = "Plant photograph";
        photo.style.width = "100%";
        photo.style.maxHeight = "320px";
        photo.style.objectFit = "contain";
        card.appendChild(photo);
      }

      const fields = {
        "Common name": plant.species?.common_name,
        "Location": plant.location_description,
        "Description": plant.description,
        "Submitted": plant.registered_at
          ? new Date(plant.registered_at).toLocaleString()
          : "—"
      };

      for (const [name, value] of Object.entries(fields)) {
        addInfo(card, name, value);
      }

      for (const decision of ["approved", "rejected"]) {
        const button = document.createElement("button");
        button.className = decision === "rejected" ? "btn red" : "btn";
        button.textContent = decision === "approved" ? "Approve" : "Reject";

        button.onclick = async () => {
          if (!confirm(`${button.textContent} this plant?`)) return;

          try {
            await api(`/plants/${plant.id}/review`, {
              method: "PATCH",
              body: JSON.stringify({ decision })
            });

            showToast(`Plant ${decision} successfully.`);
            await loadPendingPlants();
          } catch (error) {
            showToast(error.message);
          }
        };

        card.appendChild(button);
      }

      detail.appendChild(card);
    }

    for (const plant of data) {
      const button = document.createElement("button");
      button.className = "btn";
      button.textContent =
        plant.species?.scientific_name || `Plant ${plant.id.slice(0, 8)}`;
      button.onclick = () => showPlant(plant);
      list.appendChild(button);
    }

    if (data.length) showPlant(data[0]);

  } catch (error) {
    count.textContent = "Could not load plants: " + error.message;
  }
}

loadPendingPlants();
