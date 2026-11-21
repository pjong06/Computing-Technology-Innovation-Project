// editor.js - the Species record editor page.
// Officers add and edit species in the real species table (/api/knowledge), the same one the
// mobile app reads. Botanists can't change the catalogue: they send a species proposal, which
// the officer approves or rejects on the Species catalogue page.
//
// Sections: Identity, Classification and protection, About this species, and for an existing
// species (officers only) Photos from its plants and Distribution. Species have no photos of
// their own any more: photos belong to plants and are added to plants in the app.

drawMenu('editor.html');

const OTHER_FAMILY = '__other';
const PLANT_PHOTO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let editingId = '';        // the species being edited, or '' for a new one
let editing = null;        // that species as the backend sent it
let taxonomyRows = [];     // every family and genus, for the Family list
let saving = false;

const me = getCurrentUser();
const isBotanistUser = (me !== null && isBotanist(me));

// The families in the taxonomy list, once each, A-Z.
function familyNames() {
  const seen = {};
  const names = [];
  for (let i = 0; i < taxonomyRows.length; i++) {
    const family = String(taxonomyRows[i].family || '').trim();
    if (family && !seen[family.toLowerCase()]) {
      seen[family.toLowerCase()] = true;
      names.push(family);
    }
  }
  return names.sort((a, b) => a.localeCompare(b));
}

// Fills the Family list: "Not set", every family, then "Other family" (type a new one).
function fillFamilyOptions() {
  const select = document.getElementById('f-fam');
  const datalist = document.getElementById('family-options');
  select.replaceChildren();
  datalist.replaceChildren();
  const add = (value, label) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  };
  add('', 'Not set');
  for (const family of familyNames()) {
    add(family, family);
    const suggestion = document.createElement('option');
    suggestion.value = family;
    datalist.appendChild(suggestion);
  }
  add(OTHER_FAMILY, 'Other family (type it)');
}

// Shows the "New family name" box only when "Other family" is chosen.
function showOtherFamily() {
  const other = document.getElementById('f-fam').value === OTHER_FAMILY;
  document.getElementById('family-other-label').hidden = !other;
  if (other) document.getElementById('f-fam-other').focus();
}

// Selects a family in the list, or "Other family" with the name typed in when it isn't listed.
function chooseFamily(family) {
  const select = document.getElementById('f-fam');
  const wanted = String(family || '').trim();
  const match = Array.from(select.options).find(option =>
    option.value !== OTHER_FAMILY && option.value.toLowerCase() === wanted.toLowerCase());
  if (match) {
    select.value = match.value;
  } else {
    select.value = OTHER_FAMILY;
    document.getElementById('f-fam-other').value = wanted;
  }
  document.getElementById('family-other-label').hidden = select.value !== OTHER_FAMILY;
}

// The family to save: the one chosen, or the one typed for "Other family".
function chosenFamily() {
  const value = document.getElementById('f-fam').value;
  return value === OTHER_FAMILY ? document.getElementById('f-fam-other').value.trim() : value;
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

// ---- Photos from its plants (read-only) ----

function renderPlantPhotos(gallery) {
  const grid = document.getElementById('plant-photo-grid');
  const message = document.getElementById('plant-photo-message');
  grid.replaceChildren();
  const items = Array.isArray(gallery && gallery.items) ? gallery.items : [];
  const total = Number(gallery && gallery.total) || 0;
  if (gallery && gallery.error) {
    message.textContent = gallery.error;
    return;
  }
  if (items.length === 0) {
    message.textContent = 'None of its approved plants has a photo yet.';
    return;
  }
  message.textContent = '';
  for (const photo of items) {
    const figure = document.createElement('figure');
    const link = document.createElement('a');
    if (PLANT_PHOTO_UUID.test(String(photo.plant_id || ''))) {
      link.href = 'plant.html?id=' + encodeURIComponent(photo.plant_id);
    }
    const image = document.createElement('img');
    image.src = photo.url || PICTURE_BLANK;
    image.alt = 'Plant ' + displayTag(photo.tag, 'without a tag');
    image.loading = 'lazy';
    image.onerror = function () {
      image.onerror = null;
      image.src = PICTURE_BLANK;
    };
    const caption = document.createElement('figcaption');
    caption.textContent = displayTag(photo.tag, 'No tag');
    link.appendChild(image);
    link.appendChild(caption);
    figure.appendChild(link);
    grid.appendChild(figure);
  }
  if (total > items.length) {
    const more = document.createElement('a');
    more.className = 'plant-photo-more';
    more.href = 'plants.html?species=' + encodeURIComponent(editingId);
    more.textContent = '+' + (total - items.length) + ' more';
    grid.appendChild(more);
  }
}

// ---- Distribution (officers only) ----

// A small map of the species' active plants, how many there are, and a link to the Plants
// page filtered by this species. Uses the officer map and plant catalogue endpoints.
async function loadDistribution() {
  const countText = document.getElementById('distribution-count');
  const link = document.getElementById('distribution-link');
  const mapElement = document.getElementById('distribution-map');
  let points = [];
  let total = null;
  try {
    const [map, facets] = await Promise.all([
      api('/officer/map/plants'),
      api('/officer/plants/facets')
    ]);
    points = (Array.isArray(map && map.data) ? map.data : []).filter(plant =>
      plant.species && plant.species.id === editingId &&
      Number.isFinite(Number(plant.latitude)) && Number.isFinite(Number(plant.longitude)));
    const counts = facets && facets.data && Array.isArray(facets.data.species_counts)
      ? facets.data.species_counts : [];
    const entry = counts.find(item => item.species_id === editingId);
    total = entry ? entry.count : 0;
  } catch (error) {
    countText.textContent = 'The plants of this species could not be loaded. ' + error.message;
    return;
  }

  countText.textContent = total === 0
    ? 'No plants of this species have been recorded yet.'
    : total + ' active plant' + (total === 1 ? '' : 's') +
      (points.length < total ? ', ' + points.length + ' with a location on the map.' : '.');
  link.href = 'plants.html?species=' + encodeURIComponent(editingId);
  link.textContent = 'View all ' + total + ' plant' + (total === 1 ? '' : 's');
  link.hidden = total === 0;

  if (points.length === 0) return;
  if (typeof L === 'undefined') {
    countText.textContent += ' The map could not load. Check your internet connection.';
    return;
  }
  mapElement.hidden = false;
  const map = L.map(mapElement);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri'
  }).addTo(map);
  const latLngs = points.map(plant => [Number(plant.latitude), Number(plant.longitude)]);
  points.forEach((plant, index) => {
    L.circleMarker(latLngs[index], { radius: 6, weight: 1, color: '#334f3f', fillOpacity: 0.8 })
      .bindTooltip(displayTag(plant.tag, 'No tag'))
      .addTo(map);
  });
  if (latLngs.length === 1) map.setView(latLngs[0], 16);
  else map.fitBounds(latLngs, { padding: [32, 32], maxZoom: 17 });
}

// ---- Opening the page ----

// Fills the form when the page opens: with the species to edit, or empty boxes for a new one.
async function startEditor() {
  const wanted = readStorage(EDIT_KEY);
  writeStorage(EDIT_KEY, '');
  // Only a species id opens an existing species (an old saved number means "new").
  editingId = typeof wanted === 'string' ? wanted : '';
  if (isBotanistUser) {
    editingId = '';
  }

  document.getElementById('f-fam').onchange = showOtherFamily;

  if (isBotanistUser) {
    document.getElementById('editor-title').innerHTML = 'Request <span>a species</span>';
    document.getElementById('officer-note').hidden = true;
    document.getElementById('approval-note').hidden = false;
    // The officer sets the conservation status and how far it was identified when approving.
    document.getElementById('status-label').hidden = true;
    document.getElementById('rank-label').hidden = true;
    document.getElementById('save-button').textContent = 'Send species request';
  }
  try {
    taxonomyRows = await loadTaxonomy();
  } catch (error) {
    showToast('Could not load the families: ' + error.message);
  }
  fillFamilyOptions();

  if (editingId === '') {
    if (!isBotanistUser) {
      document.getElementById('editor-title').innerHTML = 'Add <span>species record</span>';
    }
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
  document.getElementById('f-rank').value = ['species', 'genus', 'family', 'other'].includes(editing.taxon_rank)
    ? editing.taxon_rank : 'species';
  document.getElementById('f-com').value = editing.common_name || '';
  chooseFamily(familyOfTaxonomy(editing.taxonomy_id));
  document.getElementById('f-status').value = STATUS_LABELS[editing.conservation_status] ? editing.conservation_status : '';
  document.getElementById('f-local').value = editing.local_name || '';
  document.getElementById('f-habitat').value = editing.habitat || '';
  document.getElementById('f-desc').value = editing.description || '';
  loadDraftNote().catch(showUnexpectedError);

  // Archive only an approved species (archived ones are already hidden from the app).
  document.getElementById('archive-button').hidden = editing.verification_status !== 'approved';

  document.getElementById('plant-photos-section').hidden = false;
  renderPlantPhotos(editing.plant_photos);
  document.getElementById('distribution-section').hidden = false;
  loadDistribution().catch(showUnexpectedError);
}

// ---- Draft text (filled in by scripts/species-descriptions/fill.mjs) ----

// Officers see "Draft description: please review" on a species whose description, habitat or
// common name was drafted and not yet reviewed. Visitors and the app show the text as usual.
async function loadDraftNote() {
  const note = document.getElementById('draft-note');
  note.hidden = true;
  if (isBotanistUser || !editingId) return;
  const result = await api('/knowledge/species/' + editingId + '/draft-status');
  note.hidden = !(result && result.data && result.data.description_is_draft === true);
}

async function markReviewed() {
  const button = document.getElementById('mark-reviewed-button');
  button.disabled = true;
  try {
    await api('/knowledge/species/' + editingId + '/mark-reviewed', { method: 'POST' });
    document.getElementById('draft-note').hidden = true;
    showToast('Marked as reviewed.');
  } catch (error) {
    showToast('Could not mark it as reviewed. ' + error.message);
  } finally {
    button.disabled = false;
  }
}

// ---- Saving ----

// The text in a box, or null when it is empty (the database stores "nothing" as null).
function textOrNull(id) {
  const value = document.getElementById(id).value.trim();
  return value === '' ? null : value;
}

// For botanists: sends the species as a proposal for the officer to review.
async function sendProposal(sci) {
  const family = chosenFamily();
  const proposal = {
    scientific_name: sci,
    // The proposal's own ID, so a retried request isn't saved twice.
    client_record_id: crypto.randomUUID(),
    common_name: textOrNull('f-com'),
    local_name: textOrNull('f-local'),
    family: family === '' ? null : family,
    habitat: textOrNull('f-habitat'),
    description: textOrNull('f-desc')
  };
  await api('/knowledge/species/proposals', { method: 'POST', body: JSON.stringify(proposal) });
  rememberToast('Species request sent. The officer will review it.');
  location.href = 'species.html';
}

// For officers: saves the species (new or edited), then goes back to the catalogue.
async function saveAsOfficer(sci) {
  if (document.getElementById('f-fam').value === OTHER_FAMILY && chosenFamily() === '') {
    showToast('Type the new family name, or choose a family from the list');
    return;
  }
  const species = {
    scientific_name: sci,
    taxon_rank: document.getElementById('f-rank').value,
    common_name: textOrNull('f-com'),
    local_name: textOrNull('f-local'),
    habitat: textOrNull('f-habitat'),
    description: textOrNull('f-desc'),
    conservation_status: document.getElementById('f-status').value || null,
    taxonomy_id: await taxonomyIdFor(taxonomyRows, chosenFamily(), sci)
  };

  let saved;
  if (editingId === '') {
    saved = await api('/knowledge/species', { method: 'POST', body: JSON.stringify(species) });
  } else {
    saved = await api('/knowledge/species/' + editingId, { method: 'PATCH', body: JSON.stringify(species) });
  }

  rememberToast(saved && saved.taxon_rank_saved === false
    ? "Species saved. \"Identified to\" can't be saved yet. Please contact the system administrator."
    : 'Species saved.');
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
    document.getElementById('f-sci').focus();
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

// ---- Archiving ----

// Asks for confirmation, then archives the species (the same as Archive on the catalogue).
// Archived species stay in the database but disappear from the mobile app's list.
async function archiveFromEditor() {
  if (isBotanistUser || editingId === '' || !editing) return;
  const sure = confirm('Archive ' + editing.scientific_name +
    '? It will no longer appear in the mobile app. Plants already recorded keep their species.');
  if (sure === false) return;
  const button = document.getElementById('archive-button');
  button.disabled = true;
  try {
    await api('/knowledge/species/' + editingId, { method: 'DELETE' });
  } catch (error) {
    showToast('Could not archive the species: ' + error.message);
    button.disabled = false;
    return;
  }
  rememberToast('Species archived');
  location.href = 'species.html';
}

startEditor().catch(showUnexpectedError);
