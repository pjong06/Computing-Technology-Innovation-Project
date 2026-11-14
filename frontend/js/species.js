// species.js - the Species catalogue page. Every plant species is shown as a card with a big photo.
// The species come from the real species table (/api/knowledge), the same one the mobile app reads.
// Officers see every approved and archived species and the botanists' proposals; botanists see
// the approved species and can propose a new one.

drawMenu('species.html');

const viewer = getCurrentUser();
const viewerIsOfficer = viewer !== null && isBotanist(viewer) === false;

let speciesList = [];   // the species shown in the grid, as the backend sent them
let proposals = [];     // pending proposals (officers only)
let taxonomyRows = [];  // used to link a family when approving a proposal
let proposalBusy = false;

// Makes the big photo box of a card. The status pill sits on the photo.
// The photo link is asked for after the card is drawn (the links last one minute).
function makePlantPhoto(species) {
  const photoArea = document.createElement('div');
  photoArea.className = 'plant-photo-area';
  const box = document.createElement('div');
  box.className = 'plant-photo';

  const img = document.createElement('img');
  img.alt = species.scientific_name;
  img.loading = 'lazy';
  img.decoding = 'async';
  // A broken picture link shows the blank leaf instead.
  img.onerror = function () {
    img.onerror = null;
    img.src = PICTURE_BLANK;
  };
  img.src = PICTURE_BLANK;
  // Only approved species have photo links (the botanists' list holds approved species only).
  if (species.verification_status === 'approved' || viewerIsOfficer === false) {
    speciesPhoto(species).then(function (photo) {
      if (photo?.url) {
        img.src = photo.url;
        const credit = makeSpeciesPhotoCredit(photo, true);
        if (credit) photoArea.appendChild(credit);
      }
    }).catch(function () {
      // No photo link: the blank leaf stays.
    });
  }
  box.appendChild(img);

  box.appendChild(makePill(statusLabel(species.conservation_status)));
  photoArea.appendChild(box);
  return photoArea;
}

// The family of a species (from its taxonomy row), or ''.
function familyOf(species) {
  return species.taxonomy && species.taxonomy.family ? species.taxonomy.family : '';
}

// Makes the text under the photo: the common name, the scientific name, the family and local name.
function makePlantInfo(species) {
  const info = document.createElement('div');
  info.className = 'plant-info';

  // Plants without a common name show their scientific name as the main title.
  const name = document.createElement('div');
  name.className = 'plant-name';
  name.textContent = species.common_name || species.scientific_name;
  if (!species.common_name) {
    name.classList.add('latin');
  }
  info.appendChild(name);

  if (species.common_name) {
    const scientific = document.createElement('div');
    scientific.className = 'plant-sci';
    scientific.textContent = species.scientific_name;
    info.appendChild(scientific);
  }

  const details = [];
  if (familyOf(species)) {
    details.push(familyOf(species));
  }
  if (species.local_name) {
    details.push(species.local_name);
  }
  if (species.verification_status === 'archived') {
    details.push('Archived: hidden from the mobile app');
  }
  if (details.length > 0) {
    const place = document.createElement('div');
    place.className = 'plant-place';
    place.textContent = details.join(' · ');
    place.title = place.textContent;
    info.appendChild(place);
  }
  return info;
}

// Makes one card for one species.
function makePlantCard(species) {
  const card = document.createElement('div');
  card.className = 'plant-card';

  card.appendChild(makePlantPhoto(species));
  card.appendChild(makePlantInfo(species));

  // Botanists can't change the catalogue (they propose new species instead).
  if (viewerIsOfficer === false) {
    card.style.cursor = 'default';
    return card;
  }

  card.onclick = function () {
    openSpeciesEditor(species.id);
  };

  const editButton = document.createElement('button');
  editButton.className = 'btn ghost';
  editButton.textContent = 'Edit';
  editButton.onclick = function (event) {
    event.stopPropagation();
    openSpeciesEditor(species.id);
  };

  const buttons = document.createElement('div');
  buttons.className = 'plant-actions';
  buttons.appendChild(editButton);

  if (species.verification_status === 'approved') {
    const archiveButton = document.createElement('button');
    archiveButton.className = 'btn ghost';
    archiveButton.textContent = 'Archive';
    archiveButton.onclick = function (event) {
      event.stopPropagation();
      archiveSpecies(species).catch(showUnexpectedError);
    };
    buttons.appendChild(archiveButton);
  }

  card.appendChild(buttons);
  return card;
}

// Draws the cards again, showing only the species that match the search box and the status filter.
function drawSpeciesTable() {
  const searchInput = document.getElementById('search-box');
  const statusFilter = document.getElementById('status-filter');
  const grid = document.getElementById('species-grid');
  if (grid === null) {
    return;
  }
  const searchText = searchInput ? searchInput.value.toLowerCase() : '';
  const chosenStatus = statusFilter ? statusFilter.value : '';
  grid.innerHTML = '';
  let shown = 0;

  for (let i = 0; i < speciesList.length; i++) {
    const species = speciesList[i];
    const names = (species.scientific_name + ' ' + (species.common_name || '') + ' ' +
      (species.local_name || '')).toLowerCase();

    const nameMatches = names.includes(searchText);
    const statusMatches = chosenStatus === '' || statusLabel(species.conservation_status) === chosenStatus;

    if (nameMatches && statusMatches) {
      grid.appendChild(makePlantCard(species));
      shown = shown + 1;
    }
  }

  const count = document.getElementById('species-count');
  if (count) {
    count.textContent = 'Showing ' + shown + ' of ' + speciesList.length + ' species';
  }
  const noSpecies = document.getElementById('no-species');
  if (noSpecies) {
    noSpecies.hidden = shown > 0;
  }
}

// Asks for confirmation, then archives the species. Archived species stay in the database
// (plants already recorded keep their species) but disappear from the mobile app's list.
async function archiveSpecies(species) {
  const sure = confirm('Archive ' + species.scientific_name + '? It will no longer appear in the mobile app.');
  if (sure === false) {
    return;
  }
  try {
    await api('/knowledge/species/' + species.id, { method: 'DELETE' });
  } catch (error) {
    showToast('Could not archive the species: ' + error.message);
    return;
  }
  showToast('Species archived');
  await loadSpecies();
}

// Loads the species. Officers get approved and archived ones; botanists the approved list.
async function loadSpecies() {
  try {
    if (viewerIsOfficer) {
      const all = await fetchAllPages('/knowledge/species/manage');
      // Pending and rejected species are proposals, shown in their own section below.
      speciesList = all.filter(function (species) {
        return species.verification_status === 'approved' || species.verification_status === 'archived';
      });
    } else {
      speciesList = await fetchAllPages('/knowledge/species');
    }
  } catch (error) {
    speciesList = [];
    const grid = document.getElementById('species-grid');
    if (grid) {
      grid.innerHTML = '';
    }
    const noSpecies = document.getElementById('no-species');
    if (noSpecies) {
      noSpecies.hidden = true;
    }
    const count = document.getElementById('species-count');
    if (count) {
      count.textContent = 'Could not load the species: ' + error.message;
    }
    return;
  }
  drawSpeciesTable();
}

// ---------- Species proposals (officers) ----------

// Makes one row for one proposal: what the botanist sent, and the Approve and Reject buttons.
function makeProposalCard(proposal) {
  const card = document.createElement('div');
  card.className = 'card';

  const title = document.createElement('h3');
  title.style.marginTop = '0';
  const name = document.createElement('i');
  name.className = 'sci';
  name.textContent = proposal.scientific_name;
  title.appendChild(name);
  card.appendChild(title);

  addInfo(card, 'Proposed by', proposal.proposer_name || 'Botanist');
  if (proposal.common_name) {
    addInfo(card, 'Common name', proposal.common_name);
  }
  if (proposal.local_name) {
    addInfo(card, 'Local name', proposal.local_name);
  }
  addInfo(card, 'Family', proposal.proposed_family || 'Not given');
  if (proposal.habitat) {
    addInfo(card, 'Habitat', proposal.habitat);
  }
  addInfo(card, 'Description', proposal.description || 'No description');

  const approveButton = document.createElement('button');
  approveButton.className = 'btn';
  approveButton.textContent = 'Approve';
  approveButton.disabled = proposalBusy;
  approveButton.onclick = function () {
    reviewProposal(proposal, 'approved').catch(showUnexpectedError);
  };

  const rejectButton = document.createElement('button');
  rejectButton.className = 'btn red';
  rejectButton.textContent = 'Reject';
  rejectButton.disabled = proposalBusy;
  rejectButton.onclick = function () {
    reviewProposal(proposal, 'rejected').catch(showUnexpectedError);
  };

  const buttons = document.createElement('div');
  buttons.className = 'acts';
  buttons.appendChild(approveButton);
  buttons.appendChild(rejectButton);
  card.appendChild(buttons);
  return card;
}

function drawProposals() {
  const list = document.getElementById('proposals-list');
  if (list === null) {
    return;
  }
  list.innerHTML = '';
  for (let i = 0; i < proposals.length; i++) {
    list.appendChild(makeProposalCard(proposals[i]));
  }
  const count = document.getElementById('proposals-count');
  if (count) {
    count.textContent = proposals.length === 0
      ? 'No proposals waiting. New ones from the mobile app appear here.'
      : proposals.length + ' waiting for review';
  }
}

// Approves (linking the proposed family) or rejects (with a reason) one proposal.
async function reviewProposal(proposal, decision) {
  if (proposalBusy) {
    return;
  }
  const body = { decision: decision };
  if (decision === 'rejected') {
    const typed = prompt('Why are you rejecting ' + proposal.scientific_name + '? The botanist will see this reason.');
    if (typed === null) {
      return;
    }
    if (typed.trim() === '') {
      showToast('Please type a reason');
      return;
    }
    body.comment = typed.trim();
  }

  proposalBusy = true;
  drawProposals();
  try {
    if (decision === 'approved' && proposal.proposed_family) {
      // Link the family the botanist typed, so the species shows its family everywhere.
      if (taxonomyRows.length === 0) {
        taxonomyRows = await loadTaxonomy();
      }
      body.taxonomy_id = await taxonomyIdFor(taxonomyRows, proposal.proposed_family, proposal.scientific_name);
    }
    await api('/knowledge/species/proposals/' + proposal.id + '/review', {
      method: 'PATCH',
      body: JSON.stringify(body)
    });
    showToast(decision === 'approved'
      ? proposal.scientific_name + ' approved. It now appears in the mobile app.'
      : 'Proposal rejected');
  } catch (error) {
    showToast('Could not review the proposal: ' + error.message);
  }
  proposalBusy = false;
  await loadProposals();
  if (decision === 'approved') {
    await loadSpecies();
  }
}

async function loadProposals() {
  try {
    proposals = await fetchAllPages('/knowledge/species/proposals/pending');
  } catch (error) {
    proposals = [];
    const list = document.getElementById('proposals-list');
    if (list) {
      list.innerHTML = '';
    }
    const count = document.getElementById('proposals-count');
    if (count) {
      count.textContent = 'Could not load the proposals: ' + error.message;
    }
    return;
  }
  drawProposals();
}

// Botanists propose instead of adding.
if (viewerIsOfficer === false) {
  const addButton = document.getElementById('add-species');
  if (addButton) {
    addButton.textContent = 'Propose a species';
  }
}

loadSpecies().catch(showUnexpectedError);
if (viewerIsOfficer) {
  const proposalsSection = document.getElementById('proposals-section');
  if (proposalsSection) {
    proposalsSection.hidden = false;
  }
  loadProposals().catch(showUnexpectedError);
}
