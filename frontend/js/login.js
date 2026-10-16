// login.js - the Log in page for officers and botanists.

// If someone is already logged in, skip the form and go to their home page.
const alreadyIn = getCurrentUser();
if (alreadyIn !== null) {
  goToHome();
}

// Shows a red message under the form. Pass '' to hide it.
function showAuthError(message) {
  const box = document.getElementById('auth-error');
  box.textContent = message;
  box.hidden = (message === '');
}

// Tells a suspended botanist to contact the officer, with a link that opens their email program.
function showSuspended() {
  const box = document.getElementById('auth-error');
  box.textContent = 'This account is suspended. Please contact the officer at ';
  const link = document.createElement('a');
  link.href = 'mailto:' + OFFICER_CONTACT_EMAIL;
  link.textContent = OFFICER_CONTACT_EMAIL;
  box.appendChild(link);
  box.hidden = false;
}

// Checks the email and password. If they are right, logs in and opens the right page.
async function doLogin() {
  const username = document.getElementById('login-username').value.trim();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  if (username === '' || email === '' || password === '') {
    showAuthError('Enter your username, email and password.');
    return;
  }

  // The username, the email and the password must all belong to the same account.
  const user = findUserByUsername(username);
  if (user === null || user.passwordHash === '' || sameText(user.email, email) === false) {
    showAuthError('Wrong username, email or password.');
    return;
  }

  // The password is scrambled together with the user's email (see hashPassword).
  const hash = await hashPassword(user.email, password);

  // The same message for every mistake, so it does not reveal which usernames or emails exist.
  if (user.passwordHash !== hash) {
    showAuthError('Wrong username, email or password.');
    return;
  }
  if (user.active === false) {
    showSuspended();
    return;
  }

  showAuthError('');
  startSession(user);
  goToHome();
}

// Pressing Enter in the password box also logs in.
document.getElementById('login-password').onkeydown = function (event) {
  if (event.key === 'Enter') {
    doLogin();
  }
};
