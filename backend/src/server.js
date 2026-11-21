
const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
});

const express = require('express');
const app = express();
// Render's observed route: client -> Cloudflare -> forwarding proxies -> app.
// Revalidate this hop count if the ingress path changes; never expose a shorter path.
app.set('trust proxy', 3);
const PORT = process.env.PORT || 3000;

// IMPORT ROUTES AND SERVICES

const plantRoutes = require('./routes/plants');
const identifyRoutes = require('./routes/identify');
const iotRoutes = require('./routes/iot');
const knowledgeRoutes = require('./routes/knowledge');
const qrBatchRoutes = require('./routes/qrBatch');
const observationRoutes = require('./routes/observations');
const reportRoutes = require('./routes/reports');
const authRoutes = require('./routes/auth');
const officerReviewRoutes = require('./routes/officerReviews');
const publicPlantRoutes = require('./routes/publicPlants');
const webDataRoutes = require('./routes/webData');
const syncRoutes = require('./routes/sync');

const { publicClient } = require('./config/supabase');
const { requireAuth, requireRole } = require('./middleware/auth');
const { startMqttIngestion } = require('./services/mqttIngestionService');
const officerMapRoutes = require('./routes/officerMap');
const officerPlantsRoutes = require('./routes/officerPlants');
const officerOverviewRoutes = require('./routes/officerOverview');

// MIDDLEWARE

app.disable('x-powered-by');

// Security headers on every response (portal pages and API), before the body parsers and
// routes so errors and 404s get them too. The portal CSP starts in report-only mode while
// the old inline handlers and styles are moved out. HSTS is sent only on secure requests,
// using the trust proxy setting above.
const { createPortalSecurityHeaders } = require('./middleware/portalSecurityHeaders');
app.use(createPortalSecurityHeaders({ portalCspMode: 'report-only' }));

app.use('/api/ingestion/telemetry', express.json({ limit: '16kb' }), require('./routes/iotIngestion').createIngestionRouter());
app.use(express.json({ limit: '25mb' }));

app.use(require('./middleware/jsonErrorHandler'));

// API ROUTES

// Mount before the generic IoT router so shared AI reads keep their own staff guard.
// Importing this app in tests never starts background processing.
// Legacy monitoring/local-camera endpoints remain Officer-only. Assigned Botanist
// tasks use /api/iot-workspace, with a scoped user client and RLS on every read.
app.use('/api/iot', requireAuth, requireRole('officer'));
const { installCameraAI } = require('../camera-ai/install.cjs');
const cameraAI = installCameraAI(app, requireAuth, process.env, { startProcessing: false });

app.use('/api/plants', plantRoutes);

app.use('/api/identify', identifyRoutes);

// Camera router distinguishes shared photo reads from Officer-only operations.
app.use('/api/iot', requireAuth, require('./routes/iotCamera').createCameraRouter());
app.use('/api/iot', requireAuth, iotRoutes);
// Unified IoT monitoring and alert-handling workspace.
app.use('/api/iot-workspace', requireAuth, require('./routes/iotWorkspace').createWorkspaceRouter());

app.use('/api/knowledge', knowledgeRoutes);

app.use('/api/qr-batch', qrBatchRoutes);

app.use('/api/tag-reservations', require('./routes/tagReservations'));

app.use('/api/observations', observationRoutes);

app.use('/api/reports', reportRoutes);

app.use('/api/auth', authRoutes);

app.use('/api/officer/reviews', officerReviewRoutes);

app.use('/api/web-data', webDataRoutes);

app.use('/api/sync', requireAuth, requireRole('botanist'), syncRoutes);

app.use('/api/officer/map', officerMapRoutes);

// Trace routes uploaded from the phone (botanists only; separate from /api/sync).
app.use('/api/routes', require('./routes/fieldRoutes'));
app.use('/api/officer/plants', officerPlantsRoutes);
app.use('/api/officer/overview', officerOverviewRoutes);

// Public plant routes
app.use(publicPlantRoutes);

// FRONTEND PORTAL

app.use(
  '/portal',
  express.static(path.join(__dirname, '..', '..', 'frontend'))
);

// BASIC API STATUS

app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'Niah Biodiversity Backend API is running',
  });
});

app.get('/api/health', (_req, res) => {
  res.json({
    message: 'Niah Biodiversity Backend API is running',
  });
});

// SUPABASE CONNECTION CHECK

app.get('/api/health/supabase', async (_req, res) => {
  const { error } = await publicClient.rpc('public_plant_by_qr', {
    p_qr: '__connection_check__',
  });

  if (error) {
    console.error('Supabase check error:', error);

    return res.status(500).json({
      message: 'Supabase check failed',
    });
  }

  res.json({
    message: 'Backend connected to Supabase',
  });
});

// PUBLIC PLANT QR CODE LOOKUP
// Return approved public plant information for a QR code.
const { createQrLimiter } = require('./middleware/publicQrProtection');
const qrLimiter = createQrLimiter({
  limit: Number(process.env.QR_RATE_LIMIT || 60),
  windowMs: Number(process.env.QR_RATE_WINDOW_MS || 60000),
});

app.get('/api/public/plants/by-qr', qrLimiter, publicPlantRoutes.createPublicQrHandler(publicClient));

// CURRENT USER INFORMATION

// Staff and visitor accounts (see routes/me.js); every other route stays staff-only.
const meRoutes = require('./routes/me');
app.use('/api/me', meRoutes);
app.use('/api/auth/me', meRoutes);

// ERROR HANDLING

app.use((err, req, res, next) => {

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      message: 'Photo must be 5 MB or smaller',
    });
  }

  if (err.message === 'Only JPEG, PNG and WebP images are allowed') {
    return res.status(400).json({
      message: err.message,
    });
  }

  console.error('Backend error:', err);

  return res.status(500).json({
    message: 'Internal server error',
  });
});

// START SERVER

// Only when run directly (`npm start` / `node src/server.js`). Tests load the app without
// opening a port or connecting to MQTT.
if (require.main === module) {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend server running on port ${PORT}`);

    // AI is opt-in; missing AI configuration must not take the existing API down.
    try {
      cameraAI.start();
      console.log(cameraAI.enabled ? 'Camera AI worker enabled' : 'Camera AI worker disabled');
    } catch {
      console.error('Camera AI worker unavailable; check private configuration');
    }
    const mqttClient = startMqttIngestion();
    require('../camera-ai/server-lifecycle.cjs').registerBackendShutdown({ server, cameraAI, mqttClient });
  });
}

module.exports = app;
