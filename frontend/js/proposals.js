// proposals.js - officer review of pending species proposals.

drawMenu('proposals.html');

const byId = id => document.getElementById(id);
let proposals = [];
let taxonomyRows = null;
let proposalBusy = false;
let rejectingProposal = null;

function displayDate(value) {
  if (!value) return 'Date not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
}

function addProposalInfo(card, label, value) {
  const row = document.createElement('p');
  row.className = 'proposal-value';
  const heading = document.createElement('b');
  heading.textContent = label;
  row.appendChild(heading);
  row.appendChild(document.createElement('br'));
  row.appendChild(document.createTextNode(value || 'Not provided'));
  card.appendChild(row);
}

function makeProposalCard(proposal) {
  const card = document.createElement('article');
  card.className = 'card proposal-card';

  const title = document.createElement('h2');
  const scientificName = document.createElement('i');
  scientificName.className = 'sci';
  scientificName.textContent = proposal.scientific_name || 'Unnamed species';
  title.appendChild(scientificName);
  card.appendChild(title);

  addProposalInfo(card, 'Common name', proposal.common_name);
  if (proposal.local_name) addProposalInfo(card, 'Local name', proposal.local_name);
  addProposalInfo(card, 'Family', proposal.proposed_family);
  addProposalInfo(card, 'Description', proposal.description);
  addProposalInfo(card, 'Proposed habitat / location note', proposal.habitat);
  addProposalInfo(card, 'Proposed by', proposal.proposer_name || 'Botanist');
  addProposalInfo(card, 'Proposed on', displayDate(proposal.created_at));

  const photoNote = document.createElement('p');
  photoNote.className = 'muted';
  photoNote.textContent = 'No reference photo provided.';
  card.appendChild(photoNote);

  const actions = document.createElement('div');
  actions.className = 'acts';
  const approve = document.createElement('button');
  approve.className = 'btn';
  approve.type = 'button';
  approve.textContent = 'Approve';
  approve.disabled = proposalBusy;
  approve.addEventListener('click', () => {
    void reviewProposal(proposal, 'approved').catch(showUnexpectedError);
  });

  const reject = document.createElement('button');
  reject.className = 'btn red';
  reject.type = 'button';
  reject.textContent = 'Reject';
  reject.disabled = proposalBusy;
  reject.addEventListener('click', () => openRejectDialog(proposal));
  actions.append(approve, reject);
  card.appendChild(actions);
  return card;
}

function drawProposals() {
  const list = byId('proposals-list');
  list.replaceChildren(...proposals.map(makeProposalCard));
  byId('proposals-count').textContent =
    `${proposals.length} pending species proposal${proposals.length === 1 ? '' : 's'}.`;
  byId('proposals-empty').hidden = proposals.length > 0;
  updateSpeciesProposalMenuCount(proposals.length);
}

function openRejectDialog(proposal) {
  rejectingProposal = proposal;
  byId('reject-proposal-name').textContent = proposal.scientific_name || 'Unnamed species';
  byId('reject-reason').value = '';
  byId('reject-reason').setCustomValidity('');
  byId('reject-dialog').showModal();
  byId('reject-reason').focus();
}

async function reviewProposal(proposal, decision, comment) {
  if (proposalBusy) return;
  proposalBusy = true;
  drawProposals();
  try {
    const body = { decision };
    if (decision === 'rejected') body.comment = comment;
    if (decision === 'approved' && proposal.proposed_family) {
      if (taxonomyRows === null) taxonomyRows = await loadTaxonomy();
      body.taxonomy_id = await taxonomyIdFor(
        taxonomyRows,
        proposal.proposed_family,
        proposal.scientific_name
      );
    }
    await api('/knowledge/species/proposals/' + proposal.id + '/review', {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    showToast(decision === 'approved'
      ? proposal.scientific_name + ' approved and added to the species catalogue.'
      : 'Species proposal rejected.');
  } catch (error) {
    showToast('Could not review the species proposal. ' + error.message);
  } finally {
    proposalBusy = false;
    await loadProposals();
  }
}

async function loadProposals() {
  const loading = byId('proposals-loading');
  const errorBox = byId('proposals-error');
  loading.hidden = false;
  errorBox.hidden = true;
  try {
    proposals = await fetchAllPages('/knowledge/species/proposals/pending');
    drawProposals();
  } catch (error) {
    proposals = [];
    byId('proposals-list').replaceChildren();
    byId('proposals-count').textContent = 'Pending species proposals are unavailable.';
    byId('proposals-empty').hidden = true;
    errorBox.textContent = error.message === 'Could not load species proposals'
      ? 'Could not load species proposals. Please try again.'
      : 'Could not load species proposals. ' + (error.message || 'Please try again.');
    errorBox.hidden = false;
  } finally {
    loading.hidden = true;
  }
}

if (pageAllowed === false) {
  // guardPages is redirecting the user; do not request officer data.
} else {
  byId('reject-cancel').addEventListener('click', () => byId('reject-dialog').close());
  byId('reject-form').addEventListener('submit', event => {
    event.preventDefault();
    const reason = byId('reject-reason').value.trim();
    if (!reason) {
      byId('reject-reason').setCustomValidity('Enter a reason for rejecting this proposal.');
      byId('reject-reason').reportValidity();
      return;
    }
    byId('reject-dialog').close();
    if (rejectingProposal) {
      void reviewProposal(rejectingProposal, 'rejected', reason).catch(showUnexpectedError);
    }
    rejectingProposal = null;
  });
  byId('reject-reason').addEventListener('input', () => byId('reject-reason').setCustomValidity(''));
  loadProposals().catch(showUnexpectedError);
}
