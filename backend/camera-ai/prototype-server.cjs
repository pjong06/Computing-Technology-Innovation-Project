'use strict';
const path = require('node:path');
require('dotenv').config({path:[path.join(__dirname,'../.env'),path.join(__dirname,'../camera.local.env'),path.join(__dirname,'../../../Computing-Technology-Innovation-Project/backend/.env')],quiet:true});
const express = require('express');
const { installCameraAI } = require('./install.cjs');

function main() {
  const { requireAuth } = require('../src/middleware/auth');
  const app = express(); app.disable('x-powered-by');
  app.set('env','production');
  const worker = installCameraAI(app,requireAuth);
  app.get('/api/health',(_req,res) => res.json({service:'camera-ai-prototype',worker_enabled:worker.enabled}));
  app.use((_error,_req,res,_next) => res.sendStatus(400));
  const port = Number(process.env.CAMERA_AI_PORT || 3003);
  if (!Number.isInteger(port) || port<1 || port>65535) throw new Error('AI_PORT_INVALID');
  const server = app.listen(port,'127.0.0.1',() => console.log(`Camera AI prototype: http://127.0.0.1:${port}/camera-ai-demo; worker ${worker.enabled ? 'enabled' : 'disabled'}`));
  const stop = async () => { server.close(); await worker.stop(); };
  process.once('SIGINT',stop); process.once('SIGTERM',stop);
}
try { main(); } catch { console.error('CAMERA_AI_STARTUP_CONFIG_REQUIRED'); process.exitCode=1; }
