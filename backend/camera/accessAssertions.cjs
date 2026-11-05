// Persist only canonical reason labels; never include a signed URL or raw body.
function expiryEvidence(status, body) {
  let message = body;
  try { const parsed = JSON.parse(body); message = typeof parsed.message === 'string' ? parsed.message : ''; } catch {}
  const text = typeof message === 'string' ? message.toLowerCase() : '';
  let reason = 'unclassified_response';
  if (text.includes('"exp" claim timestamp check failed')) reason = 'exp_claim_timestamp_check_failed';
  else if (['jwt expired', 'token has expired', 'token is expired'].some(value => text.includes(value))) reason = 'token_expired';
  return { status, reason, pass: [400, 401, 403].includes(status) && reason !== 'unclassified_response' };
}
module.exports = { expiryEvidence };
