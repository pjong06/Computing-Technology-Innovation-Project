// editor.js - the Plants record editor page.
// Officers add and edit species in the real species table (/api/knowledge), the same one the
// mobile app reads. Botanists can't change the catalogue: they send a species proposal, which
// the officer approves or rejects on the Species catalogue page.

drawMenu('editor.html');

let editingId = '';        // the species being edited, or '' for a new one
let editingRealPlantId = '';
let editingRealPlantSpeciesId = '';
let editing = null;        // that species as the backend sent it
let taxonomyRows = [];     // every family and genus, for the Family box
let newPhoto = null;       // a photo chosen in this visit (smaller JPEG data), or null
let hasSavedPhoto = false; // the species already has a photo on the server
let reader = null;
let saving = false;

const me = getCurrentUser();
const isBotanistUser = (me !== null && isBotanist(me));

// Shows the chosen photo (or the blank leaf) in the preview box.
function showPhoto(picture) {
  const preview = document.getElementById('photo-preview');
  preview.innerHTML = '';
  preview.appendChild(makeThumb(picture || PICTURE_BLANK, 'Species photo'));
}

async function showReadOnlyPlantPhoto(plant, species) {
  const photoInput = document.getElementById('plant-photo-input');
  const note = document.getElementById('photo-readonly-note');

  // Officers can upload or replace a missing plant photograph.
  // Botanists retain the existing read-only behaviour.
  photoInput.style.display = isBotanistUser ? 'none' : '';
  photoInput.hidden = isBotanistUser;
  photoInput.disabled = isBotanistUser;
  photoInput.value = '';

  if (note) {
    note.hidden = !isBotanistUser;
  }

  const ownPhoto =
    plant.photo_url ||
    plant.primary_photo_url ||
    plant.photo ||
    null;

  showPhoto(ownPhoto);
}

// Fills the Family box's suggestions with the families already in the database.
function fillFamilyOptions() {
  const options = document.getElementById('family-options');
  const seen = {};
  options.innerHTML = '';
  for (let i = 0; i < taxonomyRows.length; i++) {
    const family = taxonomyRows[i].family;
    if (family && !seen[family.toLowerCase()]) {
      seen[family.toLowerCase()] = true;
      const option = document.createElement('option');
      option.value = family;
      options.appendChild(option);
    }
  }
}

// The family of the species being edited, from its taxonomy row.
function familyOfTaxonomy(taxonomyId) {
  for (let i = 0; i < taxonomyRows.length; i++) {
    if (taxonomyRows[i].id === taxonomyId) {
      return taxonomyRows[i].family || '';
    }
  }
  return '';
}

async function loadRealPlantForEditing(plantId) {
  try {
    const response = await api(
      '/plants/' + encodeURIComponent(plantId)
    );

    // GET /plants/:id returns the plant directly,
    // not inside response.data.
    const plant = response.data || response;

    if (!plant.id) {
      throw new Error('Plant record not found');
    }

    if (!taxonomyRows.length) {
      taxonomyRows = await loadTaxonomy();
      fillFamilyOptions();
    }
    const allSpecies = await fetchAllPages(
      isBotanistUser ? '/knowledge/species' : '/knowledge/species/manage'
    );

    const species = allSpecies.find(function (item) {
      return item.id === plant.species_id;
    });

    if (!species) {
      throw new Error('Linked species not found');
    }

    editingRealPlantId = plant.id;
    editingRealPlantSpeciesId = plant.species_id;

    document.getElementById('editor-title').innerHTML =
      'Edit <span>plant record</span>';

    document.getElementById('f-sci').value =
      species.scientific_name || '';

    document.getElementById('f-com').value =
      species.common_name || '';

    document.getElementById('f-sci').value =
      species.scientific_name || '';

    document.getElementById('f-com').value =
      species.common_name || '';

    // Add this to display the existing family.
    document.getElementById('f-fam').value =
      species.taxonomy?.family ||
      familyOfTaxonomy(species.taxonomy_id) ||
      '';

    document.getElementById('f-local').value =
      species.local_name || '';
    
    document.getElementById('f-local').value =
      species.local_name || '';

    document.getElementById('f-habitat').value =
      species.habitat || '';

    document.getElementById('f-desc').value =
      plant.description || '';

    document.getElementById('f-status').value =
      species.conservation_status || '';

    document.getElementById('f-location').value =
      plant.location_description || '';

    if (
      Number.isFinite(Number(plant.latitude)) &&
      Number.isFinite(Number(plant.longitude)) &&
      plant.latitude != null &&
      plant.longitude != null
    ) {
      document.getElementById('f-latitude').value = plant.latitude;
      document.getElementById('f-longitude').value = plant.longitude;
    }

    // Species information is displayed for reference.
    // Keep species identity and conservation status read-only.
    [
      'f-sci',
      'f-com',
      'f-fam',
      'f-local',
      'f-habitat',
      'f-status',
      'f-latitude',
      'f-longitude',
      'f-location',
      'f-desc'
    ].forEach(function (id) {
      document.getElementById(id).disabled = false;
    });

    // Allow officers to edit Local name and Habitat.
    document.getElementById('f-local').disabled = false;
    document.getElementById('f-habitat').disabled = false;

    document.getElementById('plant-location-fields').hidden = false;

    document.getElementById('photo-label').hidden = false;
    document.getElementById('delete-plant-button').hidden = true;

    document.getElementById('save-button').textContent =
      isBotanistUser ? 'Submit for approval' : 'Save plant changes';

    document.getElementById('save-button').disabled = false;

    await showReadOnlyPlantPhoto(plant, species);

    console.log('Real plant loaded:', plant.id);

    await loadPlantObservationHistory(plant);

    prepareObservationForm({
      ...plant,
      scientific_name: species.scientific_name,
      common_name: species.common_name,
      family: familyOfTaxonomy(species.taxonomy_id),
      conservation_status: species.conservation_status,
      extra: {
        local_name: species.local_name,
        habitat: species.habitat
      }
    });

  } catch (error) {
    showToast('Could not load plant: ' + error.message);
  }
}

// Fills the form when the page opens: with the species to edit, or empty boxes for a new one.
async function startEditor() {
  const params = new URLSearchParams(window.location.search);

  const realPlantId = params.get('plant_id');

  const wanted = readStorage(EDIT_KEY);
  writeStorage(EDIT_KEY, '');

  if (realPlantId) {
    await loadRealPlantForEditing(realPlantId);
    return;
  }

  // Only a species id opens an existing species.
  editingId = typeof wanted === 'string' ? wanted : '';
  if (isBotanistUser) {
    editingId = '';
  }

  if (isBotanistUser) {
    document.getElementById('editor-title').innerHTML = 'Add <span>a plant</span>';
    document.getElementById('officer-note').hidden = true;
    document.getElementById('approval-note').hidden = false;
    // Botanists can propose conservation status and upload a photograph.
    // Neither becomes public until an officer approves the proposal.
    document.getElementById('status-label').hidden = false;
    document.getElementById('photo-label').hidden = false;
    document.getElementById('save-button').textContent = 'Send proposal';
  } else {
    try {
      taxonomyRows = await loadTaxonomy();
      fillFamilyOptions();
    } catch (error) {
      showToast('Could not load the families: ' + error.message);
    }
  }

  if (editingId) {
  document.getElementById('plant-location-fields').hidden = true;
}

  if (editingId === '') {
    if (!isBotanistUser) {
      document.getElementById('editor-title').innerHTML = 'Add <span>species and plants record</span>';
    }
    showPhoto(null);
    return;
  }

  try {
    const result = await api('/knowledge/species/' + editingId + '/manage');
    editing = result.data;
  } catch (error) {
    showToast('Could not load this species: ' + error.message);
    editingId = '';
    return;
  }
  document.getElementById('editor-title').innerHTML = 'Edit <span>species record</span>';
  // Hide the photo section when editing species (species only))
  document.getElementById('photo-label').hidden = true;
  document.getElementById('f-sci').value = editing.scientific_name || '';
  document.getElementById('f-com').value = editing.common_name || '';
  document.getElementById('f-fam').value = familyOfTaxonomy(editing.taxonomy_id);
  document.getElementById('f-status').value = STATUS_LABELS[editing.conservation_status] ? editing.conservation_status : '';
  document.getElementById('f-local').value = editing.local_name || '';
  document.getElementById('f-habitat').value = editing.habitat || '';
  document.getElementById('f-desc').value = editing.description || '';

  hasSavedPhoto = Array.isArray(editing.species_media) && editing.species_media.length > 0;
  showPhoto(null);
  if (editing.verification_status === 'approved' && hasSavedPhoto) {
    const url = await speciesPhotoUrl(editing).catch(function () { return null; });
    if (url && newPhoto === null) {
      showPhoto(url);
    }
  }
}

// Makes a photo smaller (at most 900 pixels wide or high), so big pictures still upload quickly.
// done is called with the smaller picture, or with null when the file is not a picture.
function shrinkPhoto(pictureText, done) {
  const image = new Image();
  image.onload = function () {
    const biggest = Math.max(image.width, image.height);
    let scale = 1;
    if (biggest > 900) {
      scale = 900 / biggest;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const pen = canvas.getContext('2d');
    pen.fillStyle = '#ffffff';
    pen.fillRect(0, 0, canvas.width, canvas.height);
    pen.drawImage(image, 0, 0, canvas.width, canvas.height);
    done(canvas.toDataURL('image/jpeg', 0.8));
  };
  image.onerror = function () {
    done(null);
  };
  image.src = pictureText;
}

// Runs when the chosen photo file has been read. Makes it smaller, keeps it and shows it in the preview.
function photoIsRead() {
  shrinkPhoto(reader.result, function (smallPhoto) {
    if (smallPhoto === null) {
      showToast('That file is not a picture. Choose a JPG or PNG image.');
      return;
    }
    newPhoto = smallPhoto;
    showPhoto(newPhoto);
  });
}

// Starts reading the photo the user chose. Called when the file picker changes.
function previewPhoto(input) {
  const file = input.files[0];
  if (!file) {
    return;
  }
  reader = new FileReader();
  reader.onload = photoIsRead;
  reader.readAsDataURL(file);
}

// The text in a box, or null when it is empty (the database stores "nothing" as null).
function textOrNull(id) {
  const value = document.getElementById(id).value.trim();
  return value === '' ? null : value;
}

// Uploads the chosen photo to the species, and makes it the main photo when it has none.
async function uploadPhoto(speciesId) {
  const blob = await (await fetch(newPhoto)).blob();
  const form = new FormData();
  form.append('photo', blob, 'species.jpg');
  const uploaded = await api('/knowledge/species/' + speciesId + '/photos', { method: 'POST', body: form });
  if (!hasSavedPhoto) {
    await api('/knowledge/species/' + speciesId + '/photos/' + uploaded.data.id + '/primary', { method: 'PATCH' });
  }
}

// For botanists: register an individual plant under an existing approved species.
// This does not edit the species catalogue and remains pending officer review.
async function submitExistingSpeciesPlant(species) {
  if (!newPhoto) throw new Error('Please upload an image of the plant.');
  const latText = document.getElementById('f-latitude').value.trim();
  const lonText = document.getElementById('f-longitude').value.trim();
  const latitude = Number(latText), longitude = Number(lonText);
  if (!latText || !lonText || !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error('Please enter valid GPS coordinates.');
  }
  const created = await api('/plants', {
    method: 'POST',
    body: JSON.stringify({
      species_id: species.id,
      client_record_id: crypto.randomUUID(),
      latitude, longitude,
      location_description: textOrNull('f-location'),
      description: textOrNull('f-desc')
    })
  });
  const plantId = created.plant?.id || created.data?.id || created.id;
  if (!plantId) throw new Error('Plant saved, but the server did not return its ID.');
  const blob = await (await fetch(newPhoto)).blob();
  const form = new FormData();
  form.append('photo', blob, 'plant.jpg');
  form.append('client_photo_id', crypto.randomUUID());
  form.append('photo_type', 'whole_plant');
  try {
    await api('/plants/' + encodeURIComponent(plantId) + '/photo', {
      method: 'POST', body: form
    });
  } catch (error) {
    throw new Error('Plant saved as pending, but its photograph failed: ' + error.message);
  }
  rememberToast('Plant and photograph submitted for officer approval.');
  location.href = 'species-plants.html?id=' + encodeURIComponent(species.id);
}

async function submitBotanistPlantOrSpecies(sci) {
  const normalized = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  const scientificName = sci.trim().replace(/\s+/g, ' ');

  // Search by scientific name on the server. Do not rely solely on the
  // catalogue's first page or on the officer-only management endpoint.
  const response = await api('/knowledge/species?q=' +
    encodeURIComponent(scientificName) + '&page=1&page_size=100');
  const candidates = response.data || [];
  let match = candidates.find(row =>
    normalized(row.scientific_name) === normalized(scientificName));

  // Also inspect all approved pages for unusual pagination/search behaviour.
  if (!match) {
    const allApproved = await fetchAllPages('/knowledge/species');
    match = allApproved.find(row =>
      normalized(row.scientific_name) === normalized(scientificName));
  }

  if (match) {
    return submitExistingSpeciesPlant(match);
  }

  // No approved match: check if a proposal with this name is already pending.
  // The database must not create a second species with the same name.
  const mine = await api('/knowledge/species/proposals/mine');
  const proposed = (mine.data || []).find(row =>
    normalized(row.scientific_name) === normalized(scientificName) &&
    row.verification_status === 'pending');
  if (proposed) {
    throw new Error('This species is awaiting officer approval. Once approved, you can register individual plants under it.');
  }
  return sendProposal(scientificName);
}

// For botanists: sends the species as a proposal for the officer to review.

async function sendProposal(sci) {
  if (newPhoto === null) {
    showToast('Please upload an image of the plant.');
    return;
  }

  const latitudeText =
    document.getElementById('f-latitude').value.trim();

  const longitudeText =
    document.getElementById('f-longitude').value.trim();

  if (latitudeText === '' || longitudeText === '') {
    showToast('Please enter the plant GPS coordinates.');
    return;
  }

  const latitude = Number(latitudeText);
  const longitude = Number(longitudeText);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    showToast('Please enter valid GPS coordinates.');
    return;
  }

  const proposal = {
    scientific_name: sci,
    client_record_id: crypto.randomUUID(),
    common_name: textOrNull('f-com'),
    local_name: textOrNull('f-local'),
    family: textOrNull('f-fam'),
    habitat: textOrNull('f-habitat'),
    description: textOrNull('f-desc'),
    conservation_status:
      document.getElementById('f-status').value || null,

    latitude,
    longitude,
    location_description: textOrNull('f-location'),
    photo: newPhoto
  };

  // The photo is uploaded separately, not inside the JSON.
  delete proposal.photo;

  const result = await api('/knowledge/species/proposals', {
    method: 'POST',
    body: JSON.stringify(proposal)
  });

  const proposalId = result.data.id;

  // Convert the compressed JPEG data into a file upload.
  const blob = await (await fetch(newPhoto)).blob();

  const form = new FormData();
  form.append('photo', blob, 'proposal.jpg');

  try {
    await api(
      '/knowledge/species/proposals/' +
        encodeURIComponent(proposalId) +
        '/photo',
      {
        method: 'POST',
        body: form
      }
    );
  } catch (error) {
    showToast(
      'Proposal details were saved, but the photo upload failed: ' +
      error.message
    );
    return;
  }

  rememberToast('Proposal and photograph submitted for officer approval.');
  location.href = 'species.html';
}


// For officers: saves the species (new or edited) and its photo, then goes back to the catalogue.
async function saveAsOfficer(sci) {
  // A new species needs a photo, so the catalogue and the app can show what it looks like.
  if (editingId === '' && newPhoto === null) {
    showToast('Please upload an image of the plant.');
    return;
  }

  const species = {
    scientific_name: sci,
    common_name: textOrNull('f-com'),
    local_name: textOrNull('f-local'),
    habitat: textOrNull('f-habitat'),
    description: textOrNull('f-desc'),
    conservation_status: document.getElementById('f-status').value || null,
    taxonomy_id: await taxonomyIdFor(taxonomyRows, document.getElementById('f-fam').value, sci)
  };

  let saved;
  if (editingId === '') {
    saved = await api('/knowledge/species', { method: 'POST', body: JSON.stringify(species) });
  } else {
    saved = await api('/knowledge/species/' + editingId, { method: 'PATCH', body: JSON.stringify(species) });
  }

  if (newPhoto !== null) {
    if (saved.data.verification_status !== 'approved') {
      rememberToast('Species saved. Photos can only be added to approved species.');
      location.href = 'species.html';
      return;
    }
    try {
      await uploadPhoto(saved.data.id);
    } catch (error) {
      // The species is saved; only the photo failed. Stay here so it can be tried again.
      editingId = saved.data.id;
      editing = saved.data;
      showToast('Species saved, but the photo did not upload: ' + error.message);
      return;
    }
  }

  rememberToast('Species saved');
  location.href = 'species.html';
}

// Save a new plant under its species(if didnt have same species in the species table)
async function addNewPlant(sci) {
  const allSpecies = await fetchAllPages('/knowledge/species/manage');

  let species = allSpecies.find(function (item) {
    return item.scientific_name.trim().toLowerCase() ===
      sci.trim().toLowerCase();
  });

  // Create species if it does not exist
  if (!species) {
    const newSpecies = {
      scientific_name: sci,
      common_name: textOrNull('f-com'),
      local_name: textOrNull('f-local'),
      habitat: textOrNull('f-habitat'),
      description: textOrNull('f-desc'),
      conservation_status: document.getElementById('f-status').value || null,
      taxonomy_id: await taxonomyIdFor(
        taxonomyRows,
        document.getElementById('f-fam').value,
        sci
      )
    };

    const result = await api('/knowledge/species', {
      method: 'POST',
      body: JSON.stringify(newSpecies)
    });

    species = result.data;
  }

  // Register a real plant under the selected species.
const latText = document.getElementById('f-latitude').value.trim();
const lonText = document.getElementById('f-longitude').value.trim();

const latitude = Number(latText);
const longitude = Number(lonText);

if (
  !latText || !lonText ||
  !Number.isFinite(latitude) ||
  !Number.isFinite(longitude) ||
  latitude < -90 || latitude > 90 ||
  longitude < -180 || longitude > 180
) {
  throw new Error('Please enter valid GPS coordinates.');
}

// Register the plant and retrieve its ID.
const created = await api('/plants/officer-register', {
  method: 'POST',
  body: JSON.stringify({
    species_id: species.id,
    latitude,
    longitude,
    location_description: textOrNull('f-location'),
    description: textOrNull('f-desc')
  })
});

const plantId =
  created.plant?.id ||
  created.data?.id ||
  created.id;

if (!plantId) {
  throw new Error('Plant registered, but no plant ID was returned.');
}

// Upload the selected botanical photograph.
if (newPhoto) {
  const blob = await (await fetch(newPhoto)).blob();

  const form = new FormData();
  form.append('photo', blob, 'plant.jpg');
  form.append('client_photo_id', crypto.randomUUID());
  form.append('photo_type', 'whole_plant');

  try {
    await api(
      '/plants/' + encodeURIComponent(plantId) + '/photo',
      {
        method: 'POST',
        body: form
      }
    );
  } catch (error) {
    throw new Error(
      'Plant registered, but photograph upload failed: ' +
      error.message
    );
  }
}

rememberToast('Plant and photograph registered successfully');

location.href = 'species-plants.html?id=' +
  encodeURIComponent(species.id);
}

async function saveRealPlant() {
    if (isBotanistUser) {
        if (!editingRealPlantId) throw new Error('No plant selected');
        const proposedLocation = textOrNull('f-location');
        if (!proposedLocation) {
          showToast('Enter a location description to propose a plant edit.');
          return;
        }
        try {
          await api('/plant-portal/plant-edit-requests', {
            method: 'POST',
            body: JSON.stringify({ plant_id: editingRealPlantId,
              proposed_changes: { location_description: proposedLocation } })
          });
          rememberToast('Plant location edit submitted for officer approval.');
          location.href = 'species-plants.html?id=' + encodeURIComponent(editingRealPlantSpeciesId);
        } catch (error) {
          showToast('Could not submit edit: ' + error.message);
        }
        return;
    }
    if (!editingRealPlantId || !editingRealPlantSpeciesId) {
        showToast("No plant selected");
        return;
    }

    const button = document.getElementById("save-button");
    button.disabled = true;

    try {
        const scientificName = textOrNull("f-sci");

        if (!scientificName) {
            throw new Error("Scientific name is required");
        }

        const allSpecies = await fetchAllPages(
            "/knowledge/species/manage"
        );

        const currentSpecies = allSpecies.find(
            item => item.id === editingRealPlantSpeciesId
        );

        const targetSpecies = allSpecies.find(
            item =>
                item.scientific_name?.trim().toLowerCase() ===
                scientificName.trim().toLowerCase() &&
                item.verification_status === "approved"
        );

        let selectedSpecies = targetSpecies;

        // Create a new species if no approved match exists.
        if (!selectedSpecies) {
            if (!taxonomyRows.length) {
                taxonomyRows = await loadTaxonomy();
            }

            const newSpecies = {
                scientific_name: scientificName,
                common_name: textOrNull("f-com"),
                local_name: textOrNull("f-local"),
                habitat: textOrNull("f-habitat"),
                conservation_status:
                    document.getElementById("f-status").value || null,
                taxonomy_id: await taxonomyIdFor(
                    taxonomyRows,
                    document.getElementById("f-fam").value,
                    scientificName
                )
            };

            const created = await api("/knowledge/species", {
                method: "POST",
                body: JSON.stringify(newSpecies)
            });

            selectedSpecies = created.data || created;

            if (selectedSpecies.verification_status !== "approved") {
                throw new Error(
                    "New species was created but is not approved yet"
                );
            }
        }

        // Update the plant, including its species relationship.
        const plantChanges = {
            location_description: textOrNull("f-location"),
            description: textOrNull("f-desc")
        };

        if (selectedSpecies.id !== editingRealPlantSpeciesId) {
            plantChanges.species_id = selectedSpecies.id;
        }

        // Save plant details AFTER creating plantChanges.
        await api(
            '/plants/' + encodeURIComponent(editingRealPlantId),
            {
                method: 'PATCH',
                body: JSON.stringify(plantChanges)
            }
        );
        // Upload a new plant photograph if the officer selected one.
        if (newPhoto) {
            const blob = await (await fetch(newPhoto)).blob();

            const form = new FormData();
            form.append('photo', blob, 'plant.jpg');
            form.append('client_photo_id', crypto.randomUUID());
            form.append('photo_type', 'whole_plant');

            try {
                await api(
                    '/plants/' +
                        encodeURIComponent(editingRealPlantId) +
                        '/photo',
                    {
                        method: 'POST',
                        body: form
                    }
                );

                newPhoto = null;

            } catch (error) {
                throw new Error(
                    'Plant details saved, but photograph upload failed: ' +
                    error.message
                );
            }
        }

        // Only edit species metadata when keeping the original species.
        // Moving a plant must not overwrite another species' information.
        if (
            selectedSpecies.id === editingRealPlantSpeciesId &&
            currentSpecies
        ) {
            const speciesChanges = {
                common_name: textOrNull("f-com"),
                local_name: textOrNull("f-local"),
                habitat: textOrNull("f-habitat"),
                conservation_status:
                    document.getElementById("f-status").value || null
            };

            await api(
                "/knowledge/species/" +
                encodeURIComponent(selectedSpecies.id),
                {
                    method: "PATCH",
                    body: JSON.stringify(speciesChanges)
                }
            );
        }

        rememberToast("Plant saved successfully");

        location.href =
            "species-plants.html?id=" +
            encodeURIComponent(selectedSpecies.id);

    } catch (error) {
        showToast("Could not save plant: " + error.message);
    } finally {
        button.disabled = false;
    }
}

// Checks the form and saves. Botanists send a proposal; officers save the species.
async function saveSpecies() {
  if (saving) {
    return;
  }

  if (editingRealPlantId) {
    await saveRealPlant();
    return;
  }

  const sci = document.getElementById('f-sci').value.trim();

  if (sci === '') {
    showToast('Enter a scientific name');
    return;
  }

  saving = true;
  document.getElementById('save-button').disabled = true;

  try {
    if (isBotanistUser) {
      // Botanists submit proposals for officer approval.
      await submitBotanistPlantOrSpecies(sci);
    } else {
    // Officers can save species directly.
      
    if (editingId) {
    await saveAsOfficer(sci);
    } else {
      await addNewPlant(sci);
    }
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    saving = false;
    document.getElementById('save-button').disabled = false;
  }
}

// Display observation history
function showObservationHistory(observations) {
  const card = document.getElementById('observation-history-card');
  const list = document.getElementById('observation-history-list');
  const count = document.getElementById('observation-count');

  card.hidden = false;
  list.innerHTML = '';

  count.textContent = observations.length === 1
    ? '1 visit'
    : observations.length + ' visits';

  if (observations.length === 0) {
    list.textContent = 'No observations recorded yet.';
    return;
  }

  observations.forEach(function (observation) {
    const entry = document.createElement('div');
    entry.className = 'observation-entry';

    const heading = document.createElement('h3');
    heading.textContent = observation.date
      ? new Date(observation.date).toLocaleString()
      : 'Date not recorded';
    entry.appendChild(heading);

    const staff = document.createElement('p');
    staff.textContent = observation.staff || 'Field Staff';
    entry.appendChild(staff);

    const tags = document.createElement('div');
    tags.className = 'observation-tags';

    [
      observation.health_status,
      observation.life_stage,
      observation.height != null ? 'Height ' + observation.height : '',
      observation.diameter != null ? 'Diameter ' + observation.diameter : ''
    ].filter(Boolean).forEach(function (value) {
      const tag = document.createElement('span');
      tag.textContent = value;
      tags.appendChild(tag);
    });

    entry.appendChild(tags);

    if (observation.notes) {
      const notes = document.createElement('p');
      const cleanedNotes = String(observation.notes || "")
        .split("\n")
        .filter(line =>
            !/^\s*(GPS:|Location:)/i.test(line.trim())
        )
        .join("\n")
        .trim();

    notes.textContent = cleanedNotes;
      entry.appendChild(notes);
    }

    // Display uploaded observation photographs
    if (Array.isArray(observation.photo_urls)) {
      observation.photo_urls.forEach(function (url) {
        const img = document.createElement('img');

        img.src = url;
        img.alt = 'Observation photograph';
        img.loading = 'lazy';

        img.style.width = '100%';
        img.style.maxWidth = '400px';
        img.style.height = 'auto';
        img.style.marginTop = '12px';
        img.style.borderRadius = '8px';
        img.style.display = 'block';

        entry.appendChild(img);
      });
    }

    list.appendChild(entry);
  });
}



async function loadPlantObservationHistory(plant) {
  const card = document.getElementById("observation-history-card");
  const list = document.getElementById("observation-history-list");

  card.hidden = false;
  list.textContent = "Loading observations...";

  try {
    const response = await api(
      "/plant-portal/plants/" +
      encodeURIComponent(plant.id) +
      "/observation-history"
    );

    const observations = (response.data || []).map(item => ({
      date: item.observed_at,
      staff: item.staff_name,
      health_status: item.health_status,
      life_stage: item.life_stage,
      height: item.height_cm != null
        ? item.height_cm + " cm" : null,
      diameter: item.dbh_cm != null
        ? item.dbh_cm + " cm" : null,
      notes: item.notes,
      photo_urls: item.photo_urls || []
    }));

    showObservationHistory(observations);

  } catch (error) {
    list.textContent = "Could not load observation history.";
    console.error(error);
  }
}

// Load the observation form for the selected plant
function prepareObservationForm(plant) {
  const card = document.getElementById("add-observation-card");
  card.hidden = false;

  document.getElementById("obs-scientific-name").value =
    plant.scientific_name || "";

  document.getElementById("obs-common-name").value =
    plant.common_name || "";

  document.getElementById("obs-family").value =
    plant.family || "";

  document.getElementById("obs-conservation-status").value =
    statusLabel(plant.conservation_status);

  // Automatically display GPS coordinates from Plant Location
  const observationLatitude = document.getElementById("obs-latitude");
  const observationLongitude = document.getElementById("obs-longitude");

  const plantLatitude = document.getElementById("f-latitude");
  const plantLongitude = document.getElementById("f-longitude");

  if (observationLatitude && observationLongitude) {
      observationLatitude.value = plantLatitude?.value || "";
      observationLongitude.value = plantLongitude?.value || "";

      // Prevent users from changing the GPS in the observation form
      observationLatitude.readOnly = true;
      observationLongitude.readOnly = true;
  }

  document.getElementById("obs-local-name").value =
    plant.extra?.local_name || "";

  document.getElementById("obs-habitat").value =
    plant.extra?.habitat || "";

  document.getElementById("obs-staff").value =
    me?.name || "Field Staff";

  // Set current local date and time
  const now = new Date();
  const local = new Date(
    now.getTime() - now.getTimezoneOffset() * 60000
  );

  document.getElementById("obs-date").value =
    local.toISOString().slice(0, 16);
}

// Save a new observation
async function savePlantObservation(event) {
  event.preventDefault();

  const plantId = editingRealPlantId || window.editingWebsitePlantId;
  if (!plantId) {
    showToast("Please select a plant first");
    return;
  }

  const value = id => document.getElementById(id).value;

  const observation = {
    local_name: value("obs-local-name"),
    habitat: value("obs-habitat"),
    observed_at: new Date(value("obs-date")).toISOString(),
    height_cm: value("obs-height"),
    dbh_cm: value("obs-dbh"),
    life_stage: value("obs-life-stage"),
    health_status: value("obs-health-status"),
    latitude: value("obs-latitude"),
    longitude: value("obs-longitude"),
    location_name: value("obs-location"),
    notes: value("obs-notes")
  };

  const button = document.querySelector(
    '#observation-form button[type="submit"]'
  );

  button.disabled = true;

  try {
    if (isBotanistUser && editingRealPlantId) {
      const toNumber = id => {
        const text = value(id).trim();
        return text === '' ? null : Number(text);
      };
      const height = toNumber('obs-height');
      const diameter = toNumber('obs-dbh');
      if ([height, diameter].some(n => n !== null && (!Number.isFinite(n) || n < 0))) {
        throw new Error('Height and diameter must be non-negative numbers.');
      }
      const result = await api('/observations', {
        method: 'POST',
        body: JSON.stringify({
          client_record_id: crypto.randomUUID(),
          plant_id: editingRealPlantId,
          observed_at: observation.observed_at,
          notes: observation.notes || null,
          health_status: observation.health_status || null,
          life_stage: observation.life_stage || null,
          height_cm: height,
          diameter_cm: diameter
        })
      });
      const observationId =
      result.observation?.id ||
      result.data?.id ||
      result.id;

    if (!observationId) {
      throw new Error('Observation saved as draft, but no ID was returned.');
    }

    // Upload observation photographs BEFORE submitting for approval.
    const photoInput = document.getElementById('obs-photos');
    const selectedPhotos = Array.from(photoInput?.files || []);

    for (const photo of selectedPhotos) {
      if (!['image/jpeg', 'image/png'].includes(photo.type)) {
        throw new Error('Only JPG and PNG photographs are supported.');
      }

      if (photo.size > 5 * 1024 * 1024) {
        throw new Error('Each photograph must be 5 MB or smaller.');
      }

      const form = new FormData();

      form.append('photo', photo);
      form.append('client_photo_id', crypto.randomUUID());

      await api(
        '/observations/' +
          encodeURIComponent(observationId) +
          '/photo',
        {
          method: 'POST',
          body: form
        }
      );
    }

    // Submit only after all photographs have uploaded successfully.
    // Your existing Supabase trigger will automatically approve it.
    await api(
      '/observations/' +
        encodeURIComponent(observationId) +
        '/submit',
      {
        method: 'PATCH',
        body: JSON.stringify({})
      }
    );
    
} else {
  const result = await api(
    "/plant-portal/plants/" +
      encodeURIComponent(plantId) +
      "/observation-history",
    {
      method: "POST",
      body: JSON.stringify(observation)
    }
  );

  const observationId = result.data?.id;
  const selectedPhotos = Array.from(
    document.getElementById("obs-photos")?.files || []
  );

  if (selectedPhotos.length > 0) {
    if (!editingRealPlantId || !observationId) {
      throw new Error(
        "Observation saved, but photo upload is unavailable for this record."
      );
    }

    for (const photo of selectedPhotos) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(photo.type)) {
        throw new Error("Only JPG, PNG and WebP photographs are supported.");
      }

      if (photo.size > 5 * 1024 * 1024) {
        throw new Error("Each photograph must be 5 MB or smaller.");
      }

      const form = new FormData();
      form.append("photo", photo);
      form.append("client_photo_id", crypto.randomUUID());

      await api(
        "/plant-portal/plants/" +
          encodeURIComponent(plantId) +
          "/observation-history/" +
          encodeURIComponent(observationId) +
          "/photo",
        {
          method: "POST",
          body: form
        }
      );
    }
  }
}


  showToast("Observation saved successfully");

  // Clear only the observation-specific fields
  [
    "obs-height",
    "obs-dbh",
    "obs-life-stage",
    "obs-health-status",
    "obs-location",
    "obs-notes",
    "obs-photos"
  ].forEach(function (id) {
    document.getElementById(id).value = "";
  });

  // Set the date and time for the next observation
  const now = new Date();
  const local = new Date(
    now.getTime() - now.getTimezoneOffset() * 60000
  );

  document.getElementById("obs-date").value =
    local.toISOString().slice(0, 16);

  // Keep the existing plant information visible
  // Scientific name, common name, family,
  // conservation status, local name, habitat,
  // and field staff are not cleared.

  // Refresh observation history
  await loadPlantObservationHistory({
    id: plantId
  });


  } catch (error) {
    showToast("Could not save observation: " + error.message);
  } finally {
    button.disabled = false;
  }
}

document.getElementById("observation-form")
  .addEventListener("submit", savePlantObservation);

startEditor().catch(showUnexpectedError);
