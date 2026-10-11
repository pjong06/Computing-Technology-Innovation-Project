const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
});

const express = require('express');
const plantRoutes = require('./routes/plants');
const identifyRoutes = require('./routes/identify');
const iotRoutes = require('./routes/iot');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use('/api/plants', plantRoutes);
app.use('/api/identify', identifyRoutes);
app.use('/api/iot', iotRoutes);

app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'Niah Biodiversity Backend API is running',
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend server running on port ${PORT}`);
});
