// users.js - the User & role admin page.

drawMenu('users.html');

const ROLES = ['Botanist', 'Conservation Officer', 'Administrator'];

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

// Adds the user typed in the two boxes, with the Botanist role.
function addUser() {
  const name = document.getElementById('new-name').value.trim();
  const email = document.getElementById('new-email').value.trim();
  if (name === '' || email === '') {
    showToast('Enter name and email');
    return;
  }

  const list = getUsers();
  list.push({ name: name, email: email, role: 'Botanist', active: true });
  writeStorage(USERS_KEY, list);

  document.getElementById('new-name').value = '';
  document.getElementById('new-email').value = '';
  showToast('User added');
  drawUsers();
}

// Switches a user between Active and Suspended.
function toggleUser(index) {
  const list = getUsers();
  list[index].active = !list[index].active;
  writeStorage(USERS_KEY, list);
  drawUsers();
}

// Asks for confirmation, then deletes the user.
function deleteUser(index) {
  const list = getUsers();
  const user = list[index];

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
