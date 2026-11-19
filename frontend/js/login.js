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

// Checks the username, email and password with Supabase. If they are right, logs in and opens the website.
async function doLogin() {
  const username = document.getElementById('login-username').value.trim();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  if (username === '' || email === '' || password === '') {
    showAuthError('Enter your username, email and password.');
    return;
  }

  // 1. Supabase checks the email and password.
  const result = await sb.auth.signInWithPassword({ email: email, password: password });
  if (result.error) {
    showAuthError('Wrong username, email or password.');
    return;
  }

  // 2. The username saved on the account must match what was typed.
  const savedName = result.data.user.user_metadata.username;
  if (savedName && sameText(savedName, username) === false) {
    await sb.auth.signOut();
    showAuthError('Wrong username, email or password.');
    return;
  }

  // 3. The backend says what role this person has. A suspended account is refused here.
  let me;
  try {
    me = await api('/me');
  } catch (error) {
    await sb.auth.signOut();
    localStorage.removeItem(SESSION_KEY);
    if (/active staff profile required|active account required/i.test(error.message)) {
      showAuthError('This account is waiting for an officer to activate it, or has been suspended. Contact the officer.');
    } else {
      showAuthError(error.message);
    }
    return;
  }

  // Visitor accounts (from the mobile app) can sign in, but the portal is for staff only:
  // every page's data is staff-only on the server, so don't let them in here.
  if (['botanist', 'officer', 'researcher', 'admin'].indexOf(me.role) === -1) {
    await sb.auth.signOut();
    localStorage.removeItem(SESSION_KEY);
    showAuthError('This account is for the Niah mobile app. The web portal is for Sarawak Forestry staff.');
    return;
  }

  showAuthError('');
  startSession(me, savedName || username);
  // Officers land on the review page when anything is waiting (or the map); botanists on
  // the species catalogue. Never waits more than a moment for the counts.
  await goToHome();
}

// Pressing Enter in the password box also logs in.
document.getElementById('login-password').onkeydown = function (event) {
  if (event.key === 'Enter') {
    doLogin().catch(function (error) {
      showAuthError(error.message);
    });
  }
};
