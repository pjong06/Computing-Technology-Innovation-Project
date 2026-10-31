const express = require('express');
const router = express.Router();

// Retire the caller-directed password setter; never load privileged clients.
// Password changes require a separately verified recovery/session flow.
router.post('/temp-password', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.status(410).json({
    code: 'TEMP_PASSWORD_DISABLED',
    message: 'This password-setting endpoint is no longer available. Use the verified password recovery flow.',
  });
});

module.exports = router;
