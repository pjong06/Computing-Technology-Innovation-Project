// editor.js - the Species record editor page.
// Officers add and edit species in the real species table (/api/knowledge), the same one the
// mobile app reads. Botanists can't change the catalogue: they send a species proposal, which
// the officer approves or rejects on the Species catalogue page.

drawMenu('editor.html');

let editingId = '';        // the species being edited, or '' for a new one
let editing = null;        // that species as the backend sent it
let taxonomyRows = [];     // every family and genus, for the Family box
let newPhoto = null;       // a photo chosen in this visit (smaller JPEG data), or null
let hasSavedPhoto = false; // the species already has a photo on the server
let reader = null;
let saving = false;

const me = getCurrentUser();
const isBotanistUser = (me !== null && isBotanist(me));

// Shows the chosen photo (or the blank leaf) in the preview box.
function showPhoto(picture, photo) {
  const preview = document.getElementById('photo-preview');
  preview.innerHTML = '';
  preview.appendChild(makeThumb(picture || PICTURE_BLANK, 'Species photo'));
  const credit = makeSpeciesPhotoCredit(photo, false);
  if (credit) preview.appendChild(credit);
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

// Fills the form when the page opens: with the species to edit, or empty boxes for a new one.
async function startEditor() {
  const wanted = readStorage(EDIT_KEY);
  writeStorage(EDIT_KEY, '');
  // Only a species id opens an existing species (an old saved number means "new").
  editingId = typeof wanted === 'string' ? wanted : '';
  if (isBotanistUser) {
    editingId = '';
  }

  if (isBotanistUser) {
    document.getElementById('editor-title').innerHTML = 'Propose <span>a species</span>';
    document.getElementById('officer-note').hidden = true;
    document.getElementById('approval-note').hidden = false;
    // The officer sets the conservation status and adds photos when approving.
    document.getElementById('status-label').hidden = true;
    document.getElementById('photo-label').hidden = true;
    document.getElementById('save-button').textContent = 'Send proposal';
  } else {
    try {
      taxonomyRows = await loadTaxonomy();
      fillFamilyOptions();
    } catch (error) {
      showToast('Could not load the families: ' + error.message);
    }
  }

  if (editingId === '') {
    if (!isBotanistUser) {
      document.getElementById('editor-title').innerHTML = 'Add <span>species record</span>';
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
    const photo = await speciesPhoto(editing).catch(function () { return null; });
    if (photo?.url && newPhoto === null) {
      showPhoto(photo.url, photo);
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

// For botanists: sends the species as a proposal for the officer to review.
async function sendProposal(sci) {
  const proposal = {
    scientific_name: sci,
    // The proposal's own ID, so a retried request isn't saved twice.
    client_record_id: crypto.randomUUID(),
    common_name: textOrNull('f-com'),
    local_name: textOrNull('f-local'),
    family: textOrNull('f-fam'),
    habitat: textOrNull('f-habitat'),
    description: textOrNull('f-desc')
  };
  await api('/knowledge/species/proposals', { method: 'POST', body: JSON.stringify(proposal) });
  rememberToast('Proposal sent. The officer will review it.');
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

// Checks the form and saves. Botanists send a proposal; officers save the species.
async function saveSpecies() {
  if (saving) {
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
      await sendProposal(sci);
    } else {
      await saveAsOfficer(sci);
    }
  } catch (error) {
    // e.g. "A species with this scientific name already exists"
    showToast(error.message);
  }
  saving = false;
  document.getElementById('save-button').disabled = false;
}

startEditor().catch(showUnexpectedError);
