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

// Checks email and password with Supabase, then verifies the staff role with the backend.
async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  if (email === '' || password === '') {
    showAuthError('Enter your email and password.');
    return;
  }

  // 1. Supabase checks the email and password.
  const result = await sb.auth.signInWithPassword({ email: email, password: password });
  if (result.error) {
    showAuthError('Wrong email or password.');
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
      showAuthError(
        'This account is waiting for an officer to activate it, or has been suspended. '+'Please contact the officer at ' + OFFICER_CONTACT_EMAIL + '.'
      );
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
  startSession(me, me.full_name || me.email.split('@')[0]);
  goToHome();
}

// Pressing Enter in the password box also logs in.
document.getElementById('login-password').onkeydown = function (event) {
  if (event.key === 'Enter') {
    doLogin().catch(function (error) {
      showAuthError(error.message);
    });
  }
};
