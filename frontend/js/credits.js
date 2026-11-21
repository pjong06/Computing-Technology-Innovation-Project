// credits.js - the Photo credits page: every photo still shown in the portal or app that needs
// attribution. Species reference photos are no longer shown anywhere, so only plant photos
// taken from iNaturalist sightings are listed (GET /plants/photo-credits), with the plant,
// species, photographer and licence. Uses the shared credit helpers (needsPhotoCredit,
// photoCreditName, SPECIES_PHOTO_LICENSES). CC0 photos and field photos are not listed.
// This page is the only place these credits are shown: plant photos never show one.

drawMenu('credits.html');

// One row per credited photo, sorted by species then tag.
function creditRows(photos) {
  const rows = [];
  for (const photo of photos) {
    if (!needsPhotoCredit(photo)) continue;
    rows.push({
      tag: displayTag(photo.tag, 'Plant without a tag'),
      species: photo.scientific_name || 'Species not recorded',
      commonName: photo.common_name || '',
      photographer: photoCreditName(photo),
      licence: (photo.licence_code && SPECIES_PHOTO_LICENSES[photo.licence_code]) || 'Unknown licence'
    });
  }
  return rows.sort((a, b) => a.species.localeCompare(b.species) || a.tag.localeCompare(b.tag));
}

function drawCredits(rows) {
  const body = document.getElementById('credits-body');
  body.replaceChildren();
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.appendChild(makeCell(row.tag));
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
  const result = await api('/plants/photo-credits');
  drawCredits(creditRows(Array.isArray(result && result.data) ? result.data : []));
}

if (pageAllowed !== false) {
  loadCredits().catch(error => {
    document.getElementById('credits-count').textContent =
      'Photo credits could not be loaded. ' + error.message;
  });
}
