// users.js - Admin > Users. The users are the real login accounts, saved in the table
// website_users (the database copies role and status changes to profiles, so they change
// what each person may do). Every action finds its account by id, never by row position.
// The table, sorting and paging helpers are shared with the other table pages (shared.js).

drawMenu('users.html');

const ROLES = ['Botanist', 'Conservation Officer'];
const signedIn = getCurrentUser();

// The real account status of each user (profiles.account_status), by user id. Accounts
// that signed themselves up are 'pending' until the officer activates them here.
// Officers may read every profile (RLS policy "officers read profiles").
let profileStatus = {};
const userView = { search: '', role: '', status: '', page: 1 };

async function loadProfileStatuses() {
  const result = await sb.from('profiles').select('id, account_status');
  if (result.error) {
    showToast('Could not load account statuses');
    return;
  }
  profileStatus = {};
  for (const profile of result.data) {
    profileStatus[profile.id] = profile.account_status;
  }
}

// Not active and never activated by the officer.
function isPending(user) {
  return !user.active && profileStatus[user.id] === 'pending';
}

// 'active', 'pending' or 'suspended', with its words and pill colour.
function accountStatus(user) {
  if (user.active) return { value: 'active', label: 'Active', css: 'pill' };
  if (isPending(user)) return { value: 'pending', label: 'Pending approval', css: 'pill w' };
  return { value: 'suspended', label: 'Suspended', css: 'pill e' };
}

function displayName(user) {
  return user.name || user.username || user.email || 'This account';
}

// The signed-in officer's own account can't be changed from here.
function isProtected(user) {
  return Boolean(signedIn) && user.id === signedIn.id;
}

// Saves the list with one account changed (found by id). Returns true when it was saved.
function saveUserChange(id, change) {
  const list = getUsers();
  const user = list.find(item => item.id === id);
  if (!user) {
    showToast('That account is no longer in the list. Reload the page.');
    return false;
  }
  change(user, list);
  if (writeStorage(USERS_KEY, list)) return true;
  showToast('The change could not be saved. Reload the page and try again.');
  return false;
}

function makeRoleSelect(user) {
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Role of ' + displayName(user));
  ROLES.forEach(role => select.add(new Option(role, role)));
  select.value = user.role;
  select.onchange = function () {
    // There is exactly one officer account (the signed-in officer's, which is protected).
    if (select.value === 'Conservation Officer') {
      showToast('There is only one officer account.');
      select.value = user.role;
      return;
    }
    if (saveUserChange(user.id, account => { account.role = select.value; })) {
      showToast(displayName(user) + ' is now a ' + select.value + '.');
    }
    drawUsers();
  };
  return select;
}

function actionButton(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn ghost';
  button.textContent = label;
  button.onclick = onClick;
  return button;
}

const USER_COLUMNS = [
  { key: 'name', label: 'Name', className: 'col-name', render: (td, user) => td.appendChild(clippedText(user.name || '—')) },
  { key: 'username', label: 'Username', className: 'col-username', render: (td, user) => td.appendChild(clippedText(user.username || '—')) },
  { key: 'email', label: 'Email', className: 'col-email', render: (td, user) => td.appendChild(clippedText(user.email || '—')) },
  {
    key: 'role', label: 'Role', className: 'col-role',
    render: (td, user) => td.appendChild(isProtected(user) ? clippedText(user.role) : makeRoleSelect(user)),
  },
  {
    key: 'status', label: 'Status', className: 'col-status',
    render: (td, user) => {
      const status = accountStatus(user);
      td.appendChild(labelSpan(status.css, status.label));
    },
  },
  {
    key: 'actions', label: '', className: 'col-actions',
    render: (td, user) => {
      if (isProtected(user)) {
        td.appendChild(labelSpan('protected', 'Protected account'));
        return;
      }
      const buttons = labelSpan('user-actions');
      const status = accountStatus(user).value;
      buttons.appendChild(actionButton(status === 'active' ? 'Suspend' : 'Activate', () => toggleUser(user.id)));
      buttons.appendChild(actionButton('Delete', () => deleteUser(user.id)));
      td.appendChild(buttons);
    },
  },
];

// Newest account first by default. Accounts are stored in the order they were added
// (website_users.sort_order: each new account gets the next number), so newest first is
// that order reversed.
let userSort = SORT_NEWEST;

function shownUsers() {
  const needle = userView.search.toLowerCase();
  const list = getUsers().filter(function (user) {
    if (needle && !(String(user.name || '') + ' ' + String(user.email || '')).toLowerCase().includes(needle)) return false;
    if (userView.role && user.role !== userView.role) return false;
    if (userView.status && accountStatus(user).value !== userView.status) return false;
    return true;
  });
  return userSort === SORT_NEWEST ? list.reverse() : list;
}

function drawUsers() {
  const total = getUsers().length;
  const rows = shownUsers();
  const count = document.getElementById('users-count');
  count.textContent = total === 0
    ? 'No accounts yet. Add a botanist above.'
    : (rows.length === total ? '' : rows.length + ' of ') + total + ' account' + (total === 1 ? '' : 's');
  addListSortSelect('users-count', 'users-sort', function (order) {
    userSort = order;
    drawUsers();
  });
  const pages = Math.max(1, Math.ceil(rows.length / TABLE_PAGE_SIZE));
  userView.page = Math.min(userView.page, pages);
  drawDataTable(document.getElementById('users-table'), {
    columns: USER_COLUMNS,
    rows: pageOf(rows, userView.page),
    keyOf: user => user.id,
    empty: total === 0 ? 'No accounts yet.' : 'No accounts match the search or filters.',
  });
  drawPager(document.getElementById('users-pager'), userView.page, rows.length, function (page) {
    userView.page = page;
    drawUsers();
  });
}

// A plain message for an account Supabase refused to create (its own text stays in the console).
function plainAccountError(error) {
  const text = String((error && error.message) || '');
  if (/already (been )?registered|already exists/i.test(text)) {
    return 'An account with this email already exists.';
  }
  if (/password/i.test(text)) {
    return 'The temporary password was not accepted. Use a longer password and try again.';
  }
  if (/invalid.*email|email.*invalid/i.test(text)) {
    return 'That email address is not valid.';
  }
  if (/rate limit|too many/i.test(text)) {
    return 'Too many accounts were created just now. Please wait a minute and try again.';
  }
  return 'The account could not be created. Please try again.';
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
    console.error('Account could not be created:', result.error);
    showToast(plainAccountError(result.error));
    return;
  }

  // The database added the new user (pending, inactive). Load the list again, then
  // activate the new account (by id, or by email if the id isn't known): the sync trigger
  // copies that to the profile.
  reloadFromDatabase(USERS_KEY);
  const newId = result.data && result.data.user ? result.data.user.id : null;
  const list = getUsers();
  const added = list.find(user => (newId && user.id === newId) || sameText(user.email, email));
  document.getElementById('new-username').value = '';
  document.getElementById('new-email').value = '';
  document.getElementById('new-password').value = '';
  if (!added) {
    showToast('Account created. Activate it in the list once it appears.');
  } else {
    added.active = true;
    if (writeStorage(USERS_KEY, list)) {
      showToast('User added and activated');
    }
  }
  await loadProfileStatuses();
  drawUsers();
}

// Suspends an active account, or activates a pending / suspended one (found by id).
function toggleUser(id) {
  const user = getUsers().find(item => item.id === id);
  if (!user || isProtected(user)) return;
  const name = displayName(user);
  if (user.active && !confirm('Suspend ' + name + "? They won't be able to sign in until you activate them again. Their records stay.")) {
    return;
  }
  const nowActive = !user.active;
  if (saveUserChange(id, account => { account.active = nowActive; })) {
    // The sync trigger has changed the profile; show its new status.
    profileStatus[id] = nowActive ? 'active' : 'suspended';
    showToast(name + (nowActive ? ' is now active.' : ' is now suspended.'));
  }
  drawUsers();
}

// Asks for confirmation, then deletes the account (found by id). Their records stay.
function deleteUser(id) {
  const user = getUsers().find(item => item.id === id);
  if (!user || isProtected(user)) return;
  const name = displayName(user);
  if (!confirm('Delete ' + name + "? This can't be undone. Their records stay.")) {
    return;
  }
  if (saveUserChange(id, (account, list) => { list.splice(list.indexOf(account), 1); })) {
    showToast(name + ' was deleted.');
  }
  drawUsers();
}

function startUsersPage() {
  document.getElementById('user-search').addEventListener('input', debounce(function () {
    userView.search = document.getElementById('user-search').value.trim();
    userView.page = 1;
    drawUsers();
  }));
  for (const [id, key] of [['role-filter', 'role'], ['status-filter', 'status']]) {
    document.getElementById(id).addEventListener('change', function () {
      userView[key] = document.getElementById(id).value;
      userView.page = 1;
      drawUsers();
    });
  }
  drawUsers();
  loadProfileStatuses().then(drawUsers).catch(showUnexpectedError);
}

if (pageAllowed !== false) startUsersPage();
