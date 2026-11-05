const express = require('express');
const { getCameraEvidenceService } = require('../services/cameraEvidenceService');
const { getActiveAlerts } = require('../services/iotAlertService');
const { getLatestReadings } = require('../services/iotTelemetryService');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mount below requireAuth; reads are shared, operational actions remain Officer-only.
function createCameraRouter({ service = getCameraEvidenceService, activeAlerts = getActiveAlerts, latestReadings = getLatestReadings } = {}) {
  const router = express.Router();
  router.use(['/camera', '/alerts/:alertId/camera'], (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!req.user || !req.profile) return res.sendStatus(401);
    if (!['officer', 'botanist', 'researcher'].includes(req.profile.role) || req.profile.account_status !== 'active') return res.sendStatus(403);
    next();
  });
  const officerOnly = (req, res, next) => req.profile.role === 'officer' ? next() : res.sendStatus(403);
  router.get('/camera/status', officerOnly, (req, res) => res.json(service().status()));
  router.param('alertId', (req, res, next, id) => UUID.test(id) ? next() : res.sendStatus(400));
  router.param('evidenceId', (req, res, next, id) => UUID.test(id) ? next() : res.sendStatus(400));
  router.get('/alerts/:alertId/camera', async (req, res) => {
    try { return res.json({ data: await service().list(req.params.alertId) }); }
    catch { return res.status(503).json({ message: 'Camera evidence unavailable' }); }
  });
  // Hosted dashboards read cloud metadata without accessing the laptop filesystem.
  // The authenticated staff client enforces RLS; no writer credential is used.
  router.get('/alerts/:alertId/camera/cloud', async (req, res) => {
    try {
      const result = await req.supabase.from('alert_camera_evidence')
        .select('id,alert_id,captured_at,byte_count,created_at')
        .eq('alert_id', req.params.alertId)
        .order('captured_at', { ascending: false }).order('id').limit(100);
      if (result.error) return res.status(503).json({ message: 'Cloud camera evidence unavailable' });
      return res.json({ data: result.data, limit: 100 });
    } catch { return res.status(503).json({ message: 'Cloud camera evidence unavailable' }); }
  });
  router.post('/alerts/:alertId/camera/capture', officerOnly, async (req, res) => {
    try {
      const alert = activeAlerts().find(a => a.id === req.params.alertId);
      if (!alert) return res.status(404).json({ message: 'Active local threat alert not found' });
      const reading = latestReadings().find(r => r.station_id === alert.station_id);
      if (!reading) return res.sendStatus(409);
      const result = await service().trigger({ reading, alert, databaseReadingId: reading.database_reading_id || null });
      return res.status(result.outcome === 'captured' ? 201 : 202).json(result);
    } catch { return res.status(503).json({ message: 'Camera capture unavailable; check local runtime/device' }); }
  });
  router.get('/alerts/:alertId/camera/:evidenceId/image', async (req, res) => {
    try {
      const image = await service().image(req.params.alertId, req.params.evidenceId);
      if (!image) return res.sendStatus(404);
      res.set('X-Content-Type-Options', 'nosniff');
      return res.type('image/jpeg').send(image);
    } catch { return res.sendStatus(503); }
  });
  router.post('/alerts/:alertId/camera/:evidenceId/retry', officerOnly, async (req, res) => {
    try {
      const record = await service().retry(req.params.alertId, req.params.evidenceId);
      return record ? res.status(record.sync_status === 'uploaded' ? 200 : 202).json({ data: record }) : res.sendStatus(404);
    } catch { return res.status(503).json({ message: 'Camera sync unavailable' }); }
  });
  router.get('/alerts/:alertId/camera/:evidenceId/url', async (req, res) => {
    // Mint as the staff user's scoped client; never use the server writer key here.
    try {
      const record = await req.supabase.from('alert_camera_evidence').select('id,alert_id,file_path').eq('id', req.params.evidenceId).eq('alert_id', req.params.alertId).maybeSingle();
      if (record.error) return res.sendStatus(503);
      if (!record.data) return res.sendStatus(404);
      const link = await req.supabase.storage.from('camera-evidence').createSignedUrl(record.data.file_path, 60);
      if (link.error || !link.data?.signedUrl) return res.sendStatus(503);
      return res.json({ url: link.data.signedUrl, expires_in: 60 });
    } catch { return res.sendStatus(503); }
  });
  return router;
}
module.exports = { createCameraRouter };
