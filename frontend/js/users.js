// users.js - the User & role admin page.
// The users are the real login accounts, saved in the table website_users.
// Changing a role or suspending someone also changes what they are allowed to do.

drawMenu('users.html');

const ROLES = ['Botanist', 'Conservation Officer'];

// The real account status of each user (profiles.account_status), by user id. Accounts
// that signed themselves up are 'pending' until the officer activates them here.
// Officers may read every profile (RLS policy "officers read profiles").
let profileStatus = {};

async function loadProfileStatuses() {
  const result = await sb.from('profiles').select('id, account_status');
  if (result.error) {
    showToast('Could not load account statuses');
    return;
  }
  profileStatus = {};
  for (let i = 0; i < result.data.length; i++) {
    profileStatus[result.data[i].id] = result.data[i].account_status;
  }
}

// Not active and never activated by the officer.
function isPending(user) {
  return !user.active && profileStatus[user.id] === 'pending';
}

// Counts the users who have the Conservation Officer role.
function countOfficers(list) {
  let count = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i].role === 'Conservation Officer') {
      count++;
    }
  }
  return count;
}

// Makes the drop-down that shows the role of a user. Changing it saves the new role.
function makeRoleSelect(index) {
  const users = getUsers();
  const select = document.createElement('select');

  for (let i = 0; i < ROLES.length; i++) {
    const option = document.createElement('option');
    option.textContent = ROLES[i];
    select.appendChild(option);
  }
  select.value = users[index].role;

  select.onchange = function () {
    const list = getUsers();
    const oldRole = list[index].role;

    // There must always be exactly one officer.
    if (select.value === 'Conservation Officer' && countOfficers(list) >= 1) {
      showToast('There is only one officer account');
      select.value = oldRole;
      return;
    }
    if (oldRole === 'Conservation Officer') {
      showToast('There must be one officer account');
      select.value = oldRole;
      return;
    }
    list[index].role = select.value;
    writeStorage(USERS_KEY, list);
    showToast('Role updated');
  };
  return select;
}

// Makes one table row for one user. index is its position in the saved list.
function makeUserRow(user, index) {
  const row = document.createElement('tr');
  row.appendChild(makeCell(user.name));
  row.appendChild(makeCell(user.username));
  row.appendChild(makeCell(user.email));

  const roleCell = document.createElement('td');
  roleCell.appendChild(makeRoleSelect(index));
  row.appendChild(roleCell);

  const pill = document.createElement('span');
  if (user.active) {
    pill.className = 'pill';
    pill.textContent = 'Active';
  } else if (isPending(user)) {
    pill.className = 'pill w';
    pill.textContent = 'Pending approval';
  } else {
    pill.className = 'pill e';
    pill.textContent = 'Suspended';
  }
  const statusCell = document.createElement('td');
  statusCell.appendChild(pill);
  row.appendChild(statusCell);

  const button = document.createElement('button');
  button.className = 'btn ghost';
  if (user.active) {
    button.textContent = 'Suspend';
  } else if (isPending(user)) {
    button.textContent = 'Activate';
  } else {
    button.textContent = 'Reactivate';
  }
  button.onclick = function () {
    toggleUser(index);
  };

  const deleteButton = document.createElement('button');
  deleteButton.className = 'btn ghost';
  deleteButton.textContent = 'Delete';
  deleteButton.onclick = function () {
    deleteUser(index);
  };

  const buttons = document.createElement('div');
  buttons.className = 'acts';
  buttons.appendChild(button);
  buttons.appendChild(deleteButton);

  const buttonCell = document.createElement('td');
  buttonCell.appendChild(buttons);
  row.appendChild(buttonCell);

  return row;
}

// Draws the table of users.
function drawUsers() {
  const list = getUsers();
  const body = document.getElementById('user-body');
  body.innerHTML = '';
  for (let i = 0; i < list.length; i++) {
    body.appendChild(makeUserRow(list[i], i));
  }
}

// Adds the user typed in the boxes. This makes a real login account with the Botanist role.
async function addUser() {
  const username = document.getElementById('new-username').value.trim();
  const email = document.getElementById('new-email').value.trim();
  const password = document.getElementById('new-password').value;
  if (username === '' || email === '' || password === '') {
    showToast('Enter username, email and password');
    return;
  }
  const passwordIssue = passwordProblem(password);
  if (passwordIssue !== '') {
    showToast(passwordIssue);
    return;
  }
  if (/^[A-Za-z0-9_]{3,20}$/.test(username) === false) {
    showToast('Username: 3-20 letters, numbers or _');
    return;
  }

  const check = await sb.rpc('website_username_taken', { wanted: username });
  if (check.error) {
    showToast('Could not check the username');
    return;
  }
  if (check.data === true) {
    showToast('That username is taken');
    return;
  }

  // A separate connection, so the officer stays logged in.
  const otherClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, storageKey: 'niah_new_user' }
  });
  const result = await createAccount(otherClient, username, email, password);
  if (result.error) {
    showToast(result.error.message);
    return;
  }

  // The database added the new user (pending, inactive). Load the list again, then
  // activate the new row: the sync trigger copies that to the profile.
  reloadFromDatabase(USERS_KEY);
  const newId = result.data && result.data.user ? result.data.user.id : null;
  const list = getUsers();
  let added = -1;
  for (let i = 0; i < list.length; i++) {
    if ((newId && list[i].id === newId) || sameText(list[i].email, email)) {
      added = i;
      break;
    }
  }
  document.getElementById('new-username').value = '';
  document.getElementById('new-email').value = '';
  document.getElementById('new-password').value = '';
  if (added === -1) {
    showToast('Account created. Activate it in the list once it appears.');
  } else {
    list[added].active = true;
    if (writeStorage(USERS_KEY, list)) {
      showToast('User added and activated');
    }
  }
  await loadProfileStatuses();
  drawUsers();
}

// Switches a user between Active and Suspended.
function toggleUser(index) {
  const list = getUsers();
  if (list[index].role === 'Conservation Officer') {
    showToast('The officer account cannot be suspended');
    return;
  }
  list[index].active = !list[index].active;
  if (writeStorage(USERS_KEY, list)) {
    // The sync trigger has changed the profile; show its new status.
    profileStatus[list[index].id] = list[index].active ? 'active' : 'suspended';
  }
  drawUsers();
}

// Asks for confirmation, then deletes the user.
function deleteUser(index) {
  const list = getUsers();
  const user = list[index];
  if (user.role === 'Conservation Officer') {
    showToast('The officer account cannot be deleted');
    return;
  }

  const sure = confirm('Delete ' + user.name + '? They will no longer be able to log in.');
  if (sure === false) {
    return;
  }

  list.splice(index, 1);
  writeStorage(USERS_KEY, list);
  showToast('User deleted');
  drawUsers();
}

drawUsers();
loadProfileStatuses().then(drawUsers);
