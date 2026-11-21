// credits.js - the Photo credits page: every species reference photo from iNaturalist that
// needs attribution (CC BY / CC BY-SA), with species, photographer and licence. Uses the same
// species lists as the catalogue and the shared credit helpers (needsPhotoCredit,
// photoCreditName, SPECIES_PHOTO_LICENSES). CC0 and SFC's own photos are not listed.

drawMenu('credits.html');

const viewer = getCurrentUser();
const creditsViewerIsOfficer = viewer !== null && isBotanist(viewer) === false;

// One row per credited photo, sorted by species then photographer.
function creditRows(speciesList) {
  const rows = [];
  for (const species of speciesList) {
    for (const photo of species.species_media || []) {
      if (!needsPhotoCredit(photo)) continue;
      rows.push({
        species: species.scientific_name || 'Unnamed species',
        commonName: species.common_name || '',
        photographer: photoCreditName(photo),
        licence: (photo.licence_code && SPECIES_PHOTO_LICENSES[photo.licence_code]) || 'Unknown licence'
      });
    }
  }
  return rows.sort((a, b) =>
    a.species.localeCompare(b.species) || a.photographer.localeCompare(b.photographer));
}

function drawCredits(rows) {
  const body = document.getElementById('credits-body');
  body.replaceChildren();
  for (const row of rows) {
    const tr = document.createElement('tr');
    const speciesCell = document.createElement('td');
    const name = document.createElement('i');
    name.className = 'sci';
    name.textContent = row.species;
    speciesCell.appendChild(name);
    if (row.commonName) {
      speciesCell.appendChild(document.createTextNode(' (' + row.commonName + ')'));
    }
    tr.appendChild(speciesCell);
    tr.appendChild(makeCell(row.photographer));
    tr.appendChild(makeCell(row.licence));
    body.appendChild(tr);
  }
  document.getElementById('credits-area').hidden = rows.length === 0;
  document.getElementById('credits-count').textContent = rows.length === 0
    ? 'No photos need a credit at the moment.'
    : rows.length + ' credited photo' + (rows.length === 1 ? '' : 's') + '.';
}

async function loadCredits() {
  // The same lists as the catalogue: officers see approved and archived species,
  // botanists the approved list.
  let speciesList;
  if (creditsViewerIsOfficer) {
    const all = await fetchAllPages('/knowledge/species/manage');
    speciesList = all.filter(species =>
      species.verification_status === 'approved' || species.verification_status === 'archived');
  } else {
    speciesList = await fetchAllPages('/knowledge/species');
  }
  drawCredits(creditRows(speciesList));
}

if (pageAllowed !== false) {
  loadCredits().catch(error => {
    document.getElementById('credits-count').textContent =
      'Photo credits could not be loaded. ' + error.message;
  });
}
