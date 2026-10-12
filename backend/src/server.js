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

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use('/api/plants', plantRoutes);
app.use('/api/identify', identifyRoutes);
app.use('/api/iot', requireAuth, requireRole('officer'), iotRoutes);
app.use('/api/knowledge', knowledgeRoutes);

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

function currentUser(req, res) {
  res.json({ id: req.user.id, email: req.user.email, role: req.profile.role });
}

app.get('/api/me', requireAuth, currentUser);
app.get('/api/auth/me', requireAuth, currentUser);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend server running on port ${PORT}`);
});
