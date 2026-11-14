// rejected.js - Rejected Observations page.
// Allows conservation officers to view rejected observations,
// reopen them for evaluation, or permanently delete them.
// Displays uploaded observation photographs when available.

drawMenu('rejected.html');

let rejected = [];
let selectedId = null;

const rejectedPhotoCache = new Map();

async function loadRejectedPhotos(observationId) {
  if (rejectedPhotoCache.has(observationId)) {
    return rejectedPhotoCache.get(observationId);
  }

  const result = await api(
    '/officer/rejected-actions/' +
    encodeURIComponent(observationId) +
    '/photos'
  );

  const photos = (result.data || [])
    .map(photo =>
      photo.signed_url ||
      photo.signedUrl ||
      photo.url ||
      photo.photo_url
    )
    .filter(Boolean);

  rejectedPhotoCache.set(observationId, photos);
  return photos;
}

// Makes list card for the list on the left.
function makeListCard(observation) {
  const photos = rejectedPhotoCache.get(observation.id) || [];

  return makeObservationListCard(
    observation,
    observation.id === selectedId,
    photos[0] || PICTURE_BLANK,
    function () {
      selectedId = observation.id;
      drawRejected();
    }
  );
}

// Makes the big card on the right with the details and rejection reason.
function makeDetailCard(observation) {
  const card = makeObservationDetailCard(observation);

  addInfo(card, 'Reason for rejection',
    observation.rejection_comment || 'No reason recorded');

  if (observation.rejected_at) {
    addInfo(card, 'Rejected on', visitTime(observation.rejected_at));
  }

  addPlantAndRecorder(card, observation);
  addInfo(card, 'Notes', observation.notes || 'No notes');

  const photos = rejectedPhotoCache.get(observation.id) || [];

  if (photos.length > 0) {
    const heading = document.createElement('h3');
    heading.textContent = 'Observation photographs';
    card.appendChild(heading);

    photos.forEach(function (url) {
      const img = document.createElement('img');

      img.src = url;
      img.alt = 'Rejected observation photograph';
      img.loading = 'lazy';

      img.style.width = '100%';
      img.style.maxWidth = '400px';
      img.style.height = 'auto';
      img.style.marginTop = '12px';
      img.style.borderRadius = '8px';
      img.style.display = 'block';

      card.appendChild(img);
    });
  }

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'acts';
  actions.style.marginTop = '20px';

  const evaluateButton = document.createElement('button');
  evaluateButton.className = 'btn';
  evaluateButton.textContent = 'Evaluate Again';

  evaluateButton.onclick = function () {
    evaluateAgain(observation.id).catch(showUnexpectedError);
  };

  const deleteButton = document.createElement('button');
  deleteButton.className = 'btn red';
  deleteButton.textContent = 'Permanently Delete';

  deleteButton.onclick = function () {
    permanentlyDelete(observation.id).catch(showUnexpectedError);
  };

  actions.appendChild(evaluateButton);
  actions.appendChild(deleteButton);
  card.appendChild(actions);

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
    rejected.length + ' rejected ' + word + ', requiring review or further action.';

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

let actionBusy = false;

// Send a rejected observation back to the officer approval queue.
async function evaluateAgain(observationId) {
  if (actionBusy) return;

  if (!confirm('Send this observation back to the approval queue?')) {
    return;
  }

  actionBusy = true;

  try {
    await api(
      '/officer/rejected-actions/' + encodeURIComponent(observationId) + '/reopen',
      {
        method: 'PATCH'
      }
    );

    showToast('Observation returned to approval queue.');
    selectedId = null;
    await loadRejected();

  } catch (error) {
    showToast('Could not reopen observation: ' + error.message);
  } finally {
    actionBusy = false;
  }
}

// Permanently delete a rejected observation.
async function permanentlyDelete(observationId) {
  if (actionBusy) return;

  if (!confirm(
    'Permanently delete this observation and its photographs? This cannot be undone.'
  )) {
    return;
  }

  actionBusy = true;

  try {
    await api(
      '/officer/rejected-actions/' + encodeURIComponent(observationId) + '/permanent',
      {
        method: 'DELETE'
      }
    );

    showToast('Observation permanently deleted.');
    selectedId = null;
    await loadRejected();

  } catch (error) {
    showToast('Could not delete observation: ' + error.message);
  } finally {
    actionBusy = false;
  }
}

// Loads the rejected observations from the backend.
async function loadRejected() {
  document.getElementById('rejected-count').textContent = 'Loading rejected observations...';
  try {
    const result = await api('/officer/reviews/rejected');
    rejected = result.data || [];

    rejectedPhotoCache.clear();

    const photoResults = await Promise.allSettled(
    rejected.map(function (observation) {
      return loadRejectedPhotos(observation.id);
    })
  );

  photoResults.forEach(function (result, index) {
    if (result.status === 'rejected') {
      console.warn(
        'Could not load photographs for observation:',
        rejected[index].id,
        result.reason
      );
    }
  });
  } catch (error) {
    rejected = [];
    document.getElementById('rejected-area').hidden = true;
    document.getElementById('rejected-empty').hidden = true;
    document.getElementById('rejected-count').textContent = 'Could not load rejected observations: ' + error.message;
    return;
  }
  drawRejected();
}

// Load rejected plant registrations
async function loadRejectedPlants() {
  const list = document.getElementById("rejected-plant-list");
  const detail = document.getElementById("rejected-plant-detail");
  const count = document.getElementById("rejected-plant-count");

  try {
    const result = await api("/plants/rejected-review");
    const plants = result.data || [];

    count.textContent = `${plants.length} Rejected`;
    list.replaceChildren();
    detail.replaceChildren();

    function showPlant(plant) {
      detail.replaceChildren();

      const card = document.createElement("div");
      card.className = "card";

      const title = document.createElement("h3");
      title.textContent =
        plant.species?.scientific_name || "Unknown species";
      card.appendChild(title);

      if (plant.photo_url) {
        const photo = document.createElement("img");
        photo.src = plant.photo_url;
        photo.alt = "Rejected plant photograph";
        photo.loading = "lazy";
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
          : "—",
        "Status": "Rejected"
      };

      for (const [name, value] of Object.entries(fields)) {
        const p = document.createElement("p");
        const strong = document.createElement("strong");
        strong.textContent = name + ": ";
        p.append(strong, document.createTextNode(value ?? "—"));
        card.appendChild(p);
      }

      // Action buttons for rejected plant
      const actions = document.createElement("div");
      actions.className = "acts";
      actions.style.marginTop = "20px";

      const evaluateButton = document.createElement("button");
      evaluateButton.className = "btn";
      evaluateButton.textContent = "Evaluate Again";

      evaluateButton.onclick = async () => {
        if (!confirm("Return this plant to the approval queue?")) return;

        evaluateButton.disabled = true;

        try {
          await api(`/plants/${plant.id}/reopen`, {
            method: "PATCH"
          });

          showToast("Plant returned to approval queue.");
          await loadRejectedPlants();
        } catch (error) {
          showToast(error.message);
          evaluateButton.disabled = false;
        }
      };

      const deleteButton = document.createElement("button");
      deleteButton.className = "btn red";
      deleteButton.textContent = "Permanently Delete";

      deleteButton.onclick = async () => {
        if (!confirm("Permanently delete this plant? This cannot be undone.")) return;

        deleteButton.disabled = true;

        try {
          await api(`/plants/${plant.id}/permanent`, {
            method: "DELETE"
          });

          showToast("Plant permanently deleted.");
          await loadRejectedPlants();
        } catch (error) {
          showToast(error.message);
          deleteButton.disabled = false;
        }
      };

      actions.append(evaluateButton, deleteButton);
      card.appendChild(actions);

      detail.appendChild(card);
    }

    for (const plant of plants) {
      const button = document.createElement("button");
      button.className = "btn";
      button.textContent =
        plant.species?.scientific_name ||
        `Plant ${plant.id.slice(0, 8)}`;

      button.onclick = () => showPlant(plant);
      list.appendChild(button);
    }

    if (plants.length > 0) {
      showPlant(plants[0]);
    } else {
      detail.textContent = "No rejected plant records found.";
    }

  } catch (error) {
    count.textContent = "Could not load rejected plants.";
    console.error("Rejected plants error:", error);
  }
}

loadRejectedPlants();
