// signup.js - the Create account page. It only makes Botanist accounts.

// Shows a red message under the form. Pass '' to hide it.
function showAuthError(message) {
  const box = document.getElementById('auth-error');
  box.textContent = message;
  box.hidden = (message === '');
}

// Checks the form. Returns a message for the first problem, or '' when everything is fine.
function checkSignup(username, email, password, confirm) {
  if (username === '' || email === '' || password === '' || confirm === '') {
    return 'Please fill in all the boxes.';
  }
  if (/^[A-Za-z0-9_]{3,20}$/.test(username) === false) {
    return 'The username must be 3-20 letters, numbers or underscores.';
  }
  if (findUserByUsername(username) !== null) {
    return 'That username is already taken. Choose another one.';
  }
  if (email.indexOf('@') < 1 || email.indexOf('.') === -1) {
    return 'Enter a valid email address.';
  }
  if (findUserByEmail(email) !== null) {
    return 'An account with this email already exists. Try logging in.';
  }
  const passwordIssue = passwordProblem(password);
  if (passwordIssue !== '') {
    return passwordIssue;
  }
  if (password !== confirm) {
    return 'The two passwords are not the same.';
  }
  return '';
}

// Creates the botanist account, logs the person in and opens the Species catalogue.
async function doSignup() {
  const username = document.getElementById('su-username').value.trim();
  const email = document.getElementById('su-email').value.trim();
  const password = document.getElementById('su-password').value;
  const confirm = document.getElementById('su-confirm').value;

  const problem = checkSignup(username, email, password, confirm);
  if (problem !== '') {
    showAuthError(problem);
    return;
  }

  // There is no separate full name, so the username is also the display name.
  const user = {
    name: username,
    username: username,
    email: email,
    role: 'Botanist',
    active: true,
    passwordHash: await hashPassword(email, password)
  };

  const list = getUsers();
  list.push(user);
  if (writeStorage(USERS_KEY, list) === false) {
    showAuthError('The account could not be saved. The browser storage is full.');
    return;
  }

  showAuthError('');
  startSession(user);
  rememberToast('Account created. Welcome, ' + username + '!');
  goToHome();
}
