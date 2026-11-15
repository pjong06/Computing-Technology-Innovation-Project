// Send 6 digit verification code
function isValidResetEmail(email) {
    const atIndex = email.indexOf('@');
    if (
        atIndex <= 0 ||
        atIndex !== email.lastIndexOf('@') ||
        atIndex >= email.length - 2
    ) {
        return false;
    }

    const dotIndex = email.indexOf('.', atIndex + 1);
    if (dotIndex <= atIndex + 1 || dotIndex >= email.length - 1) {
        return false;
    }

    for (let index = 0; index < email.length; index++) {
        const character = email[index];
        if (character === '@') {
            if (index !== atIndex) {
                return false;
            }
        } else if (character.trim() === '') {
            return false;
        }
    }

    return true;
}

async function sendResetEmail() {

    const email = document.getElementById('reset-email').value.trim();

    const sendButton = document.getElementById('reset-button');

    // Check email
    if (email === '') {
        showMessage('Please enter your registered email.', 'error');
        return;
    }

    // Check email format
    if (!isValidResetEmail(email)) {
        showMessage('Please enter a valid email address.', 'error');
        return;
    }

    sendButton.disabled = true;
    sendButton.textContent = 'Sending...';

    try {

        // Send verification code using Supabase
        const { error } = await window.sb.auth.resetPasswordForEmail(email);

        if (error) {
            throw error;
        }

        // Show verification code field
        document.getElementById('code-label').hidden = false;

        // Hide send button
        sendButton.hidden = true;

        // Show verify button
        document.getElementById('verify-button').hidden = false;

        showMessage(
            'Verification code sent! Please check your email.',
            'success'
        );

    } catch (error) {

        console.error('Send OTP error:', error);

        showMessage(
            error.message || 'Unable to send verification code.',
            'error'
        );

    } finally {

        sendButton.disabled = false;
        sendButton.textContent = 'Send verification code';

    }
}

// VERIFY 6-DIGIT CODE

async function verifyResetCode() {

    const email = document.getElementById('reset-email').value.trim();

    const code = document.getElementById('reset-code').value.trim();

    const verifyButton = document.getElementById('verify-button');

    // Check code
    if (!/^\d{6}$/.test(code)) {
        showMessage('Please enter a valid 6 digit code.', 'error');
        return;
    }

    verifyButton.disabled = true;
    verifyButton.textContent = 'Verifying...';

    try {

        // Verify the code with Supabase
        const { data, error } = await window.sb.auth.verifyOtp({

            email: email,

            token: code,

            type: 'recovery'

        });

        if (error) {
            throw error;
        }

        if (!data.session) {
            throw new Error('Verification failed. Please try again.');
        }

        // Verification successful
        showMessage(
            'Verification successful! Redirecting...',
            'success'
        );

        // Go to reset password page
        window.location.href = 'reset-password.html';

    } catch (error) {

        console.error('OTP verification error:', error);

        showMessage(
            error.message || 'Invalid or expired verification code.',
            'error'
        );

    } finally {

        verifyButton.disabled = false;
        verifyButton.textContent = 'Verify code';

    }
}

// DISPLAY MESSAGE

function showMessage(text, type) {

    const message = document.getElementById('reset-message');

    message.hidden = false;

    message.textContent = text;

    if (type === 'success') {

        message.style.color = 'green';

    } else {

        message.style.color = 'red';

    }

}
