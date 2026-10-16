// users.js - the User & role admin page.

drawMenu('users.html');

const ROLES = ['Botanist', 'Conservation Officer'];

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
  } else {
    pill.className = 'pill w';
    pill.textContent = 'Suspended';
  }
  const statusCell = document.createElement('td');
  statusCell.appendChild(pill);
  row.appendChild(statusCell);

  const button = document.createElement('button');
  button.className = 'btn ghost';
  if (user.active) {
    button.textContent = 'Suspend';
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

// Adds the user typed in the boxes, with the Botanist role and the temporary password.
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
  if (findUserByUsername(username) !== null) {
    showToast('That username is taken');
    return;
  }
  if (findUserByEmail(email) !== null) {
    showToast('That email already has an account');
    return;
  }

  const list = getUsers();
  list.push({
    name: username, username: username, email: email, role: 'Botanist', active: true,
    passwordHash: await hashPassword(email, password)
  });
  writeStorage(USERS_KEY, list);

  document.getElementById('new-username').value = '';
  document.getElementById('new-email').value = '';
  document.getElementById('new-password').value = '';
  showToast('User added');
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
  writeStorage(USERS_KEY, list);
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

  const sure = confirm('Delete ' + user.name + '? This cannot be undone.');
  if (sure === false) {
    return;
  }

  list.splice(index, 1);
  writeStorage(USERS_KEY, list);
  showToast('User deleted');
  drawUsers();
}

drawUsers();
