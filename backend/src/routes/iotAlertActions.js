const express = require('express');
const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const columns = 'id,alert_status,acknowledged_by,acknowledged_at,resolved_by,resolved_at,resolution_notes';

function transition(from, to) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!UUID.test(req.params.alertId)) return res.sendStatus(400);
    const body = req.body || {};
    const allowedKeys = to === 'resolved' ? ['resolution_notes'] : [];
    if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowedKeys.includes(key))) return res.sendStatus(400);
    if (body.resolution_notes !== undefined && (typeof body.resolution_notes !== 'string' || body.resolution_notes.length > 2000)) return res.sendStatus(400);
    try {
      const current = await req.supabase.from('alerts').select(columns).eq('id', req.params.alertId).maybeSingle();
      if (current.error) return res.sendStatus(503);
      if (!current.data) return res.sendStatus(404);
      if (current.data.alert_status === to) return res.json({ data: current.data, unchanged: true });
      if (current.data.alert_status !== from) return res.status(409).json({ message: 'Invalid alert state transition' });
      const patch = { alert_status: to };
      if (to === 'resolved') patch.resolution_notes = body.resolution_notes?.trim() || null;
      // RLS and the database trigger verify the actor and stamp the true ID/time.
      // Status comparison prevents concurrent requests from overwriting each other.
      const updated = await req.supabase.from('alerts').update(patch)
        .eq('id', req.params.alertId).eq('alert_status', from).select(columns).maybeSingle();
      if (updated.error) return res.sendStatus(503);
      if (!updated.data) return res.status(409).json({ message: 'Alert changed; refresh and retry' });
      return res.json({ data: updated.data });
    } catch { return res.sendStatus(503); }
  };
}
router.patch('/alerts/:alertId/acknowledge', transition('open', 'acknowledged'));
router.patch('/alerts/:alertId/resolve', transition('acknowledged', 'resolved'));
module.exports = router;
