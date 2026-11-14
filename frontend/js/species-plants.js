// species-plants.js - the plants recorded under one species. Opened from the Species and plants


drawMenu('species.html');

const viewer = getCurrentUser();
const viewerIsOfficer = viewer !== null && !isBotanist(viewer);
const speciesId = new URLSearchParams(location.search).get('id') || '';

async function loadSpeciesRow() {
  const all = viewerIsOfficer
    ? await fetchAllPages('/knowledge/species/manage')
    : await fetchAllPages('/knowledge/species');

  return all.find(species => species.id === speciesId) || null;
}

// Fetch only the plants belonging to this species.
async function loadRealPlants() {
  const records = [];
  for (let page = 1; page <= 100; page++) {
    const response = await api('/plants?species_id=' + encodeURIComponent(speciesId) + '&page=' + page);
    const batch = response.data || [];
    records.push(...batch.filter(p => p.plant_status === 'approved'));
    if (batch.length < 50 || page * 50 >= (response.pagination?.total ?? Infinity)) break;
  }
  return records;
}

function addLine(box, label, value) {
  if (value === null || value === undefined || value === '') {
    return;
  }

  const line = document.createElement('div');
  line.className = 'line';
  line.textContent = label + ': ' + value;
  box.appendChild(line);
}


function showSpeciesInformation(records, species, referencePhotos = []) {
  const list = document.getElementById('plant-list');
  list.innerHTML = '';

  document.getElementById('plant-count').textContent =
    records.length +
    (records.length === 1 ? ' plant record found' : ' plant records found');

  document.getElementById('no-plants').hidden = records.length > 0;

  for (const [index, record] of records.entries()) {
    const card = document.createElement('div');
    card.className = 'plant-row';
    card.style.display = 'block';

    // Plant image
    const img = document.createElement('img');
    img.className = 'plant-image';

    const ownPhoto =
      record.photo_url ||
      record.primary_photo_url ||
      record.photo ||
      '';

    const reference = referencePhotos.length
      ? referencePhotos[index % referencePhotos.length]
      : null;

    const referenceUrl =
      reference?.image_url ||
      species.reference_image_url ||
      '';

    img.src = ownPhoto || referenceUrl || PICTURE_BLANK;

    img.alt = ownPhoto
      ? species.scientific_name
      : 'Reference photo for ' + species.scientific_name;

    if (!ownPhoto && referenceUrl) {
      img.title = 'Species reference photo, not this individual plant';
    }

    img.onerror = function () {
      img.onerror = null;

      if (referenceUrl && img.src !== referenceUrl) {
        img.src = referenceUrl;

        img.onerror = function () {
          img.onerror = null;
          img.src = PICTURE_BLANK;
        };
      } else {
        img.src = PICTURE_BLANK;
      }
    };

    card.appendChild(img);

    // Reference photo attribution
    if (!ownPhoto && referenceUrl) {
      const credit = document.createElement('div');
      credit.className = 'line';

      if (reference?.observation_url) {
        const link = document.createElement('a');
        link.href = reference.observation_url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent =
          'Reference photo · ' +
          (reference.observer || 'iNaturalist') +
          (reference.license ? ' · ' + reference.license : '');

        credit.appendChild(link);
      } else {
        credit.textContent = 'Species reference photo · iNaturalist';
      }

      card.appendChild(credit);
    }

    // Plant information
    const heading = document.createElement('div');
    heading.className = 'tag';
    heading.textContent = species.scientific_name;
    card.appendChild(heading);

    addLine(card, 'Plant ID', record.id);
    addLine(card, 'Common name', species.common_name);
    addLine(card, 'Plant status', record.plant_status);
    addLine(card, 'QR code', record.qr_code_value);
    addLine(card, 'Conservation status',
      statusLabel(species.conservation_status));

    // Edit / propose changes button
    // Edit / propose changes button
    const button = document.createElement('button');
    button.className = 'btn ghost';

    button.textContent = viewerIsOfficer
    ? 'Edit plant'
    : 'View / propose plant changes';

    button.onclick = () => {
    location.href =
        'editor.html?plant_id=' + encodeURIComponent(record.id);
    };

    card.appendChild(button);

    // Delete plant button - Officer only
    if (viewerIsOfficer) {
    const deleteButton = document.createElement('button');
    deleteButton.className = 'btn ghost';
    deleteButton.textContent = 'Delete plant';
    deleteButton.style.marginLeft = '10px';

    deleteButton.onclick = async function () {
        if (!confirm('Permanently delete this plant record?')) {
        return;
        }

        deleteButton.disabled = true;

        try {
        await api('/plants/' + encodeURIComponent(record.id), {
            method: 'DELETE'
        });

        rememberToast('Plant deleted successfully');
        location.reload();

        } catch (error) {
        showToast('Could not delete plant: ' + error.message);
        deleteButton.disabled = false;
        }
    };

    card.appendChild(deleteButton);
    }

    list.appendChild(card);
    }
}

// Archive species, only for officers
async function archiveThisSpecies(species) {
  const sure = confirm(
    'Archive ' + species.scientific_name +
    '? It will no longer appear in the mobile app.'
  );

  if (!sure) return;

  try {
    await api('/knowledge/species/' + species.id, {
      method: 'DELETE'
    });

    rememberToast('Species archived');
    location.href = 'species.html';
  } catch (error) {
    showToast('Could not archive the species: ' + error.message);
  }
}

// Unarchive species, only for officers
async function unarchiveThisSpecies(species) {
  if (!confirm('Unarchive ' + species.scientific_name + '?')) {
    return;
  }

  try {
    await api('/knowledge/species/' + species.id + '/restore', {
      method: 'PATCH'
    });

    rememberToast('Species unarchived');
    location.reload();
  } catch (error) {
    showToast('Could not unarchive species: ' + error.message);
  }
}

// Permanently delete a species
async function deleteThisSpecies(species) {
  const confirmed = confirm(
    'Permanently delete ' + species.scientific_name +
    '? This cannot be undone.'
  );

  if (!confirmed) return;

  try {
    await api(
      '/knowledge/species/' +
      encodeURIComponent(species.id) +
      '/permanent',
      {
        method: 'DELETE'
      }
    );

    rememberToast('Species deleted successfully');
    location.href = 'species.html';

  } catch (error) {
    console.error('Species delete error:', error);
    alert(error.message || 'Could not delete species.');
  }
}

function drawSpeciesHead(species) {
  document.title = species.scientific_name + ' - Niah Biotrack';

  document.getElementById('species-title').textContent =
    species.scientific_name;

  document.getElementById('species-common').textContent =
    species.common_name || '';

  const details = [];

  if (species.taxonomy && species.taxonomy.family) {
    details.push(species.taxonomy.family);
  }

  if (species.local_name) {
    details.push(species.local_name);
  }

  document.getElementById('species-details').textContent =
    details.join(' · ');

  const status = document.getElementById('species-status');
  status.innerHTML = '';
  status.appendChild(makePill(statusLabel(species.conservation_status)));

  const img = document.getElementById('species-photo');
  img.alt = species.scientific_name;
  img.src = PICTURE_BLANK;

  img.onerror = function () {
    img.onerror = null;
    img.src = PICTURE_BLANK;
  };

  if (viewerIsOfficer) {
    const actions = document.getElementById('species-actions');

    const edit = document.createElement('button');
    edit.className = 'btn ghost';
    edit.textContent = 'Edit species';

    edit.onclick = function () {
      openSpeciesEditor(species.id);
    };

    actions.appendChild(edit);

    
    if (species.verification_status === 'archived') {
    const unarchive = document.createElement('button');
    unarchive.className = 'btn ghost';
    unarchive.textContent = 'Unarchive';

    unarchive.onclick = function () {
        unarchiveThisSpecies(species).catch(showUnexpectedError);
    };

    actions.appendChild(unarchive);

    } else if (species.verification_status === 'approved') {
    const archive = document.createElement('button');
    archive.className = 'btn ghost';
    archive.textContent = 'Archive';

    archive.onclick = function () {
        archiveThisSpecies(species).catch(showUnexpectedError);
    };

    actions.appendChild(archive);
    }

    // Delete species permanently
    const deleteButton = document.createElement('button');
    deleteButton.className = 'btn ghost';
    deleteButton.textContent = 'Delete';

    deleteButton.onclick = function () {
    console.log('Delete button clicked:', species.id);
    deleteThisSpecies(species).catch(showUnexpectedError);
    };

    actions.appendChild(deleteButton);
}
  document.getElementById('species-head').hidden = false;
}


async function startPage() {
  if (!speciesId) { location.replace('species.html'); return; }
  const species = await loadSpeciesRow();
  if (!species) {
    document.getElementById('plant-count').textContent = 'Species not found';
    return;
  }
  drawSpeciesHead(species);
  try {
    const [plants, referenceResponse] = await Promise.all([
      loadRealPlants(),
      api('/knowledge/species/' + encodeURIComponent(speciesId) + '/reference-photos')
        .catch(error => { console.warn('Reference photos unavailable:', error); return { data: [] }; })
    ]);
   const referencePhotos = referenceResponse.data || [];

    showSpeciesInformation(plants, species, referencePhotos);

    // Use the first REAL uploaded plant photo, otherwise the species reference photo.
    const firstPlantWithPhoto = plants.find(p => p.photo_url || p.primary_photo_url || p.photo);
    const firstPlantImageUrl = firstPlantWithPhoto && (firstPlantWithPhoto.photo_url || firstPlantWithPhoto.primary_photo_url || firstPlantWithPhoto.photo);
    const speciesImage = document.getElementById('species-photo');

    if (speciesImage) {
        if (firstPlantImageUrl) {
            speciesImage.src = firstPlantImageUrl;
        } else if (species.reference_image_url) {
            speciesImage.src = species.reference_image_url;
        } else if (referencePhotos.length && referencePhotos[0].image_url) {
            speciesImage.src = referencePhotos[0].image_url;
        } else {
            speciesImage.src = PICTURE_BLANK;
        }

        speciesImage.onerror = function () {
            speciesImage.onerror = null;
            speciesImage.src = PICTURE_BLANK;
        };
    }
  } catch (error) {
    console.error('Plant loading error:', error);
    document.getElementById('plant-count').textContent = 'Could not load plants: ' + error.message;
  }
}
startPage().catch(showUnexpectedError);
