// Save the new password after the user opens the secure link from Supabase.
async function saveNewPassword() {
  const password = document.getElementById('new-password').value;
  const confirmPassword = document.getElementById('confirm-password').value;
  const message = document.getElementById('reset-message');
  const button = document.getElementById('save-button');

  message.hidden = true;
  message.textContent = '';
  message.className = 'auth-error';

  if (password.length < 8) {
    message.textContent = 'Your password must contain at least 8 characters.';
    message.hidden = false;
    return;
  }

  if (password !== confirmPassword) {
    message.textContent = 'The passwords do not match. Please try again.';
    message.hidden = false;
    return;
  }

  button.disabled = true;
  button.textContent = 'Saving...';

  try {
    // Supabase gets the recovery session from the email link in the page URL.
    const sessionResult = await sb.auth.getSession();
    if (sessionResult.error || !sessionResult.data.session) {
      throw new Error('This reset link is invalid or has expired. Please request a new password reset email.');
    }

    const result = await sb.auth.updateUser({ password: password });
    if (result.error) {
      throw result.error;
    }

    message.className = 'auth-success';
    message.textContent = 'Your password has been changed successfully. You can now log in using your new password.';
    message.hidden = false;
    document.getElementById('new-password').value = '';
    document.getElementById('confirm-password').value = '';
    button.hidden = true;
  } catch (error) {
    message.textContent = error.message || 'Could not update your password. Please request a new reset link.';
    message.hidden = false;
    button.disabled = false;
    button.textContent = 'Save new password';
  }
}
