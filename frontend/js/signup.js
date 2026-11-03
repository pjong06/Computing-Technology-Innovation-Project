// signup.js - the Create account page. It only makes Botanist accounts.
// The account is a real Supabase login. The database then saves the new user in the table website_users.

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
  if (email.indexOf('@') < 1 || email.indexOf('.') === -1) {
    return 'Enter a valid email address.';
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

  // 1. Is the username free?
  const check = await sb.rpc('website_username_taken', { wanted: username });
  if (check.error) {
    showAuthError('Could not check the username. Has the database setup been run?');
    return;
  }
  if (check.data === true) {
    showAuthError('That username is already taken. Choose another one.');
    return;
  }

  // 2. Make the account. The database adds the profile and the row in website_users.
  const result = await createAccount(sb, username, email, password);
  if (result.error) {
    if (/already/i.test(result.error.message)) {
      showAuthError('An account with this email already exists. Try logging in.');
    } else {
      showAuthError(result.error.message);
    }
    return;
  }

  // 3. Sign out again, so the person logs in themselves on the login page.
  await sb.auth.signOut();
  localStorage.removeItem(SESSION_KEY);

  if (result.data.session) {
    rememberToast('Account created. Please log in.');
  } else {
    // Supabase wants the email confirmed first.
    rememberToast('Account created. Check your email to confirm it, then log in.');
  }
  location.href = 'login.html';
}
