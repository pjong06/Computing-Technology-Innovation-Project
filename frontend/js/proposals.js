// proposals.js - Review > Species requests (officers): the requests WAITING for a decision,
// as a table (decisions are listed in Review history). Search and Newest / Oldest sort;
// "Review" opens a request under its row with what the botanist sent, the "Before you
// decide" checks worked out by the server (services/speciesRequestChecks.js), and the two
// decisions: "Add to catalogue" (with a conservation status) or "Don't add" (a reason the
// botanist sees). "Fix name" / "Clear" save the change to the request before deciding.

drawMenu('proposals.html');

const byId = id => document.getElementById(id);
let proposals = [];
let proposalSort = SORT_NEWEST; // newest request first; the select switches it
let taxonomyRows = null;
let proposalBusy = false;
// The request open under its row: proposals.html?request=<id> (from Field records'
// "Waiting for species request") opens that one.
let openId = (function () {
  const wanted = new URLSearchParams(location.search).get('request') || '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(wanted) ? wanted : null;
})();
let searchText = '';
const reasonDrafts = {};        // a reason typed for a request, kept while the list redraws
const statusDrafts = {};        // the conservation status chosen for a request

// Quick reasons: the chip and the sentence it puts in the reason box.
const REASON_CHIPS = [
  ['Already in catalogue', 'This species is already in the catalogue.'],
  ['Name misspelled', 'The scientific name is misspelled. Please check the spelling and send it again.'],
  ['Not found in Niah', 'This species is not known from Niah National Park.'],
  ['Needs more detail', 'Please add more detail (family, a description and where you saw it) and send it again.'],
];

const botanistOf = proposal => proposal.proposer_name || 'the botanist';

// ---- table cells ----

function speciesCell(td, proposal) {
  td.appendChild(clippedText(proposal.scientific_name || 'Unnamed species', 'sci'));
  // Field records that can't be approved until this species is added.
  const waiting = Number(proposal.waiting_plants) || 0;
  if (waiting > 0) {
    td.appendChild(clippedText(waiting + (waiting === 1 ? ' plant waiting' : ' plants waiting'), 'cell-sub waiting-plants'));
  }
}

function textCell(value, fallback) {
  return function (td, proposal) {
    const text = proposal[value];
    td.appendChild(text ? clippedText(text) : labelSpan('muted-text', fallback));
  };
}

function checksCell(td, proposal) {
  const count = (proposal.checks || []).length;
  const badge = count === 0
    ? labelSpan('check-badge good', 'Looks good')
    : labelSpan('check-badge warn', count + ' to check');
  badge.title = count === 0 ? 'No problems found' : (proposal.checks || []).map(check => check.message).join('\n');
  td.appendChild(badge);
}

function toggleCell(td, proposal) {
  const open = openId === proposal.id;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn toggle-button' + (open ? ' ghost' : '');
  button.textContent = open ? 'Close' : 'Review';
  button.setAttribute('aria-expanded', String(open));
  button.setAttribute('aria-label', (open ? 'Close ' : 'Review ') + (proposal.scientific_name || 'this request'));
  button.onclick = function () {
    openId = open ? null : proposal.id;
    drawProposals();
  };
  td.appendChild(button);
}

const REQUEST_COLUMNS = [
  { key: 'species', label: 'Requested species', className: 'col-species', render: speciesCell },
  { key: 'common', label: 'Common name', className: 'col-common', render: textCell('common_name', 'None given') },
  { key: 'family', label: 'Family', className: 'col-family', render: textCell('proposed_family', 'Not given') },
  { key: 'by', label: 'Requested by', className: 'col-by', render: (td, proposal) => td.appendChild(clippedText(proposal.proposer_name || 'Unknown botanist')) },
  { key: 'on', label: 'Requested on', className: 'col-on', render: (td, proposal) => td.appendChild(clippedText(formatWhen(proposal.created_at, 'Date not recorded'))) },
  { key: 'checks', label: 'Checks', className: 'col-checks', render: checksCell },
  { key: 'toggle', label: '', className: 'col-toggle', render: toggleCell },
];

// ---- the open request ----

function section(title) {
  const box = document.createElement('section');
  const heading = document.createElement('h3');
  heading.textContent = title;
  box.appendChild(heading);
  return box;
}

function sentSection(proposal) {
  const box = section('What ' + botanistOf(proposal) + ' sent');
  const list = document.createElement('dl');
  list.className = 'sent-list';
  for (const [label, value] of [
    ['Common name', proposal.common_name],
    ['Local name', proposal.local_name],
    ['Family', proposal.proposed_family],
    ['Habitat / location note', proposal.habitat],
    ['Description', proposal.description],
  ]) {
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = value || 'Not given';
    if (!value) detail.className = 'not-given';
    list.append(term, detail);
  }
  box.appendChild(list);
  return box;
}

function checksSection(proposal) {
  const box = section('Before you decide');
  const list = document.createElement('ul');
  list.className = 'check-list';
  const checks = proposal.checks || [];
  if (checks.length === 0) {
    const item = document.createElement('li');
    item.className = 'good';
    item.appendChild(labelSpan('', '✓ Not in the catalogue yet, the name is written correctly and nothing is missing.'));
    list.appendChild(item);
  }
  for (const check of checks) {
    const item = document.createElement('li');
    item.appendChild(labelSpan('', '⚠ ' + check.message));
    if (check.fix) {
      const fix = document.createElement('button');
      fix.type = 'button';
      fix.className = 'btn ghost small';
      fix.textContent = check.fix.label;
      fix.disabled = proposalBusy;
      fix.onclick = () => void applyFix(proposal, check.fix).catch(showUnexpectedError);
      item.appendChild(fix);
    }
    list.appendChild(item);
  }
  box.appendChild(list);
  return box;
}

function addSection(proposal) {
  const box = section('Add to catalogue');
  box.className = 'decide-add';
  const label = document.createElement('label');
  label.textContent = 'Conservation status';
  const select = document.createElement('select');
  select.add(new Option(NOT_ASSESSED, ''));
  for (const [code, words] of Object.entries(STATUS_LABELS)) select.add(new Option(words, code));
  select.value = statusDrafts[proposal.id] || '';
  select.onchange = function () { statusDrafts[proposal.id] = select.value; };
  label.appendChild(select);
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn';
  add.textContent = 'Add species';
  add.disabled = proposalBusy;
  add.onclick = () => void reviewProposal(proposal, 'approved').catch(showUnexpectedError);
  box.append(label, add);
  return box;
}

function rejectSection(proposal) {
  const box = section("Don't add");
  box.className = 'decide-reject';
  const reason = document.createElement('textarea');
  reason.id = 'reject-reason';
  reason.required = true;
  reason.value = reasonDrafts[proposal.id] || '';
  reason.setAttribute('aria-describedby', 'reject-help');
  reason.oninput = function () {
    reasonDrafts[proposal.id] = reason.value;
    reason.setCustomValidity('');
  };
  const chips = document.createElement('div');
  chips.className = 'reason-chips';
  chips.setAttribute('aria-label', 'Quick reasons');
  for (const [chipLabel, sentence] of REASON_CHIPS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.textContent = chipLabel;
    chip.onclick = function () {
      reason.value = sentence;
      reasonDrafts[proposal.id] = sentence;
      reason.setCustomValidity('');
      reason.focus();
    };
    chips.appendChild(chip);
  }
  const label = document.createElement('label');
  label.htmlFor = 'reject-reason';
  label.textContent = 'Reason (required)';
  const help = document.createElement('p');
  help.id = 'reject-help';
  help.className = 'muted';
  help.textContent = botanistOf(proposal).charAt(0).toUpperCase() + botanistOf(proposal).slice(1) + ' will see this reason in the app.';
  const send = document.createElement('button');
  send.type = 'button';
  send.className = 'btn red';
  send.textContent = "Don't add and tell " + botanistOf(proposal);
  send.title = send.textContent;
  send.disabled = proposalBusy;
  send.onclick = function () {
    const text = reason.value.trim();
    if (!text) {
      reason.setCustomValidity('Enter a reason for not adding this species.');
      reason.reportValidity();
      return;
    }
    void reviewProposal(proposal, 'rejected', text).catch(showUnexpectedError);
  };
  box.append(chips, label, reason, help, send);
  return box;
}

function renderOpenRequest(td, proposal) {
  const detail = document.createElement('div');
  detail.className = 'request-detail';
  const decide = document.createElement('div');
  decide.className = 'decide-row';
  decide.append(addSection(proposal), rejectSection(proposal));
  detail.append(sentSection(proposal), checksSection(proposal), decide);
  td.appendChild(detail);
}

// ---- drawing ----

function matchesSearch(proposal) {
  if (!searchText) return true;
  const needle = searchText.toLowerCase();
  return [proposal.scientific_name, proposal.common_name, proposal.local_name, proposal.proposed_family, proposal.proposer_name]
    .some(value => String(value || '').toLowerCase().includes(needle));
}

function drawProposals() {
  addListSortSelect('proposals-count', 'proposals-sort', function (order) {
    proposalSort = order;
    drawProposals();
  });
  const shown = sortByDate(proposals.filter(matchesSearch), proposal => proposal.created_at, proposalSort);
  byId('proposals-card').hidden = proposals.length === 0;
  byId('proposals-empty').hidden = proposals.length > 0;
  byId('proposals-count').textContent = searchText
    ? `${shown.length} of ${proposals.length} species request${proposals.length === 1 ? '' : 's'}`
    : `${proposals.length} species request${proposals.length === 1 ? '' : 's'} waiting for review`;
  drawDataTable(byId('requests-table'), {
    columns: REQUEST_COLUMNS,
    rows: shown,
    keyOf: proposal => proposal.id,
    empty: 'No species requests match this search.',
    expandedKey: openId,
    renderExpanded: renderOpenRequest,
  });
  updateSpeciesProposalMenuCount(proposals.length);
}

// ---- saving ----

// "Fix name" / "Clear": saves the change to the request (officer species update), then reloads
// so the checks are worked out again.
async function applyFix(proposal, fix) {
  if (proposalBusy) return;
  proposalBusy = true;
  drawProposals();
  try {
    await api('/knowledge/species/' + proposal.id, {
      method: 'PATCH',
      body: JSON.stringify({ [fix.field]: fix.value }),
    });
    showToast(fix.field === 'scientific_name' ? 'Name changed to ' + fix.value + '.' : 'Local name cleared.');
  } catch (error) {
    showToast('The request could not be changed. ' + error.message);
  } finally {
    proposalBusy = false;
    await loadProposals();
  }
}

async function reviewProposal(proposal, decision, comment) {
  if (proposalBusy) return;
  proposalBusy = true;
  drawProposals();
  try {
    const body = { decision };
    if (decision === 'rejected') body.comment = comment;
    if (decision === 'approved' && proposal.proposed_family) {
      // Loaded once, on the first approval that needs a family; reused afterwards
      // (taxonomyIdFor adds any family it creates to this list).
      if (!Array.isArray(taxonomyRows)) taxonomyRows = await loadTaxonomy();
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
    openId = null;
    delete reasonDrafts[proposal.id];
    if (decision === 'approved') {
      await saveConservationStatus(proposal);
    } else {
      showToast('Not added. ' + botanistOf(proposal) + ' will see your reason in the app.');
    }
  } catch (error) {
    showToast('Could not save the decision. ' + error.message);
  } finally {
    proposalBusy = false;
    await loadProposals();
  }
}

// After "Add species": the conservation status chosen (nothing to save for Not assessed).
async function saveConservationStatus(proposal) {
  const code = statusDrafts[proposal.id] || '';
  delete statusDrafts[proposal.id];
  const name = proposal.scientific_name || 'The species';
  if (!code) {
    showToast(name + ' added to the species catalogue.');
    return;
  }
  try {
    await api('/knowledge/species/' + proposal.id, { method: 'PATCH', body: JSON.stringify({ conservation_status: code }) });
    showToast(name + ' added to the species catalogue as ' + statusLabel(code) + '.');
  } catch (error) {
    showToast(name + ' was added, but its conservation status could not be saved. Set it in the species editor. ' + error.message);
  }
}

async function loadProposals() {
  const loading = byId('proposals-loading');
  const errorBox = byId('proposals-error');
  loading.hidden = false;
  errorBox.hidden = true;
  try {
    proposals = await fetchAllPages('/knowledge/species/proposals/pending');
    if (openId && !proposals.some(proposal => proposal.id === openId)) openId = null;
    drawProposals();
  } catch (error) {
    proposals = [];
    byId('proposals-card').hidden = true;
    byId('proposals-empty').hidden = true;
    errorBox.textContent = error.message === 'Could not load species proposals'
      ? 'Could not load species requests. Please try again.'
      : 'Could not load species requests. ' + (error.message || 'Please try again.');
    errorBox.hidden = false;
  } finally {
    loading.hidden = true;
  }
}

if (pageAllowed === false) {
  // guardPages is redirecting the user; do not request officer data.
} else {
  byId('proposals-search').addEventListener('input', debounce(function () {
    searchText = byId('proposals-search').value.trim().slice(0, 100);
    drawProposals();
  }, 200));
  loadProposals().catch(showUnexpectedError);
}
