// species.js - the Species and plants catalogue page. Every species is a word-only button that opens
// the page of the plants recorded under it (species-plants.html).
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

// Makes one word-only button for one species. Clicking it opens the page of its plants.
function makeSpeciesButton(species) {
  const button = document.createElement('a');
  button.className = 'species-link';
  button.href = 'species-plants.html?id=' + encodeURIComponent(species.id);
  button.textContent = species.scientific_name;
  button.title = species.common_name || species.scientific_name;
  if (species.verification_status === 'archived') {
    button.classList.add('archived');
    button.title = button.title + ' (archived: hidden from the mobile app)';
  }
  return button;
}

// Draws the cards again, showing only the species that match the search box and the status filter.
function drawSpeciesTable() {
  const searchInput = document.getElementById('search-box');
  const searchText = searchInput.value.toLowerCase();
  const chosenStatus = document.getElementById('status-filter').value;
  const grid = document.getElementById('species-grid');
  grid.innerHTML = '';
  let shown = 0;

  for (let i = 0; i < speciesList.length; i++) {
    const species = speciesList[i];
    const names = (species.scientific_name + ' ' + (species.common_name || '') + ' ' +
      (species.local_name || '')).toLowerCase();

    const nameMatches = names.includes(searchText);
    const statusMatches = chosenStatus === '' || statusLabel(species.conservation_status) === chosenStatus;

    if (nameMatches && statusMatches) {
      grid.appendChild(makeSpeciesButton(species));
      shown = shown + 1;
    }
  }

  document.getElementById('species-count').textContent = 'Showing ' + shown + ' of ' + speciesList.length + ' species';
  document.getElementById('no-species').hidden = (shown > 0);
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
    document.getElementById('species-grid').innerHTML = '';
    document.getElementById('no-species').hidden = true;
    document.getElementById('species-count').textContent = 'Could not load the species: ' + error.message;
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
  list.innerHTML = '';
  for (let i = 0; i < proposals.length; i++) {
    list.appendChild(makeProposalCard(proposals[i]));
  }
  document.getElementById('proposals-count').textContent = proposals.length === 0
    ? 'No proposals waiting. New ones from the mobile app appear here.'
    : proposals.length + ' waiting for review';
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
    document.getElementById('proposals-list').innerHTML = '';
    document.getElementById('proposals-count').textContent = 'Could not load the proposals: ' + error.message;
    return;
  }
  drawProposals();
}

// Botanists propose instead of adding.
if (viewerIsOfficer === false) {
  document.getElementById('add-species').textContent = 'Propose a species';
}

loadSpecies().catch(showUnexpectedError);
if (viewerIsOfficer) {
  document.getElementById('proposals-section').hidden = false;
  loadProposals().catch(showUnexpectedError);
}

// Botanist dashboard: show server-side proposal status and officer rejection comments.
async function loadMyProposals() {
  const section = document.getElementById('my-proposals-section');
  if (viewerIsOfficer || !section) return;
  section.hidden = false;
  const list = document.getElementById('my-proposals-list');
  const count = document.getElementById('my-proposals-count');
  list.replaceChildren();
  try {
    const mine = await fetchAllPages('/knowledge/species/proposals/mine');
    count.textContent = mine.length + ' proposal(s)';
    for (const proposal of mine) {
      const card = document.createElement('div');
      card.className = 'card';
      const title = document.createElement('h3');
      title.textContent = proposal.scientific_name;
      card.appendChild(title);
      addInfo(card, 'Status', proposal.verification_status || 'pending');
      if (proposal.review_comment) addInfo(card, 'Officer feedback', proposal.review_comment);
      list.appendChild(card);
    }
  } catch (error) {
    count.textContent = 'Could not load your proposals: ' + error.message;
  }
}
if (!viewerIsOfficer) loadMyProposals().catch(showUnexpectedError);
