const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
});

const express = require('express');
const plantRoutes = require('./routes/plants');
const identifyRoutes = require('./routes/identify');
const iotRoutes = require('./routes/iot');
const { publicClient } = require("./config/supabase");
const knowledgeRoutes = require("./routes/knowledge");
const { requireAuth, requireRole } = require("./middleware/auth");
const qrBatchRoutes = require('./routes/qrBatch');
const observationRoutes = require('./routes/observations');
const reportRoutes = require('./routes/reports');
const { startMqttIngestion } = require('./services/mqttIngestionService');
const authRoutes = require('./routes/auth');
const officerReviewRoutes = require("./routes/officerReviews");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(require('./middleware/jsonErrorHandler'));
app.use('/api/plants', plantRoutes);
app.use('/api/identify', identifyRoutes);
app.use('/api/iot', requireAuth, requireRole('officer'), iotRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/qr-batch', qrBatchRoutes);
app.use('/api/observations', observationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/auth', authRoutes);
app.use("/api/officer/reviews", officerReviewRoutes);

// Serve the existing Conservation Officer portal from the same origin as its API.
app.use('/portal', express.static(path.join(__dirname, '..', '..', 'frontend')));

app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'Niah Biodiversity Backend API is running',
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ message: 'Niah Biodiversity Backend API is running' });
});

app.get('/api/health/supabase', async (_req, res) => {
  const { error } = await publicClient.rpc('public_plant_by_qr', {
    p_qr: '__connection_check__',
  });

  if (error) {
    console.error('Supabase check error:', error);
    return res.status(500).json({ message: 'Supabase check failed' });
  }

  res.json({ message: 'Backend connected to Supabase' });
});

// Return approved public plant information for a QR code.
app.get('/api/public/plants/by-qr', async (req, res) => {
  const qrCode =
    typeof req.query.code === 'string'
      ? req.query.code.trim()
      : '';

  if (!qrCode || qrCode.length > 120) {
    return res.status(400).json({ message: 'Valid QR code is required' });
  }

  const { data, error } = await publicClient.rpc(
    'public_plant_by_qr_v2',
    { p_qr: qrCode }
  );

  if (error) {
    console.error('Public QR lookup error:', error);
    return res.status(500).json({ message: 'Could not load plant information' });
  }

  if (!data || data.length === 0) {
    return res.status(404).json({ message: 'Approved plant not found' });
  }

  res.set('Cache-Control', 'no-store');
  return res.json({ data: data[0] });
});

function currentUser(req, res) {
  res.json({ id: req.user.id, email: req.user.email, role: req.profile.role });
}

app.get('/api/me', requireAuth, currentUser);
app.get('/api/auth/me', requireAuth, currentUser);

// Handle upload validation errors
app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      message: "Photo must be 5 MB or smaller"
    });
  }

  if (err.message === "Only JPEG, PNG and WebP images are allowed") {
    return res.status(400).json({
      message: err.message
    });
  }

  console.error("Backend error:", err);

  return res.status(500).json({
    message: "Internal server error"
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend server running on port ${PORT}`);
  startMqttIngestion();
});
