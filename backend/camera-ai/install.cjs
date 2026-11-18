'use strict';
const { createAIRouter } = require('./router.cjs');
const { startWorker } = require('./worker.cjs');

// Call once after environment loading and before final error/404 middleware.
function installCameraAI(app, requireAuth, env = process.env) {
  app.use('/api/iot/camera-ai',requireAuth,createAIRouter({supabaseUrl:env.SUPABASE_URL}));
  const path = require('node:path');
  let publicConfig;
  try {
    const url = new URL(env.SUPABASE_URL);
    const key = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || env.SUPABASE_KEY;
    const anon = key?.startsWith('sb_publishable_') || JSON.parse(Buffer.from(key?.split('.')[1] || '', 'base64url').toString()).role === 'anon';
    if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' && anon) publicConfig = { url:url.origin, key };
  } catch { /* Do not expose server-only keys through demo configuration. */ }
  app.use('/camera-ai-demo',(req,res,next) => {
    res.set('Cache-Control','no-store'); res.set('X-Content-Type-Options','nosniff'); res.set('X-Frame-Options','DENY');
    const connect = publicConfig ? ` ${publicConfig.url}` : '';
    res.set('Content-Security-Policy',`default-src 'none'; script-src 'self'; img-src 'self' blob:; connect-src 'self'${connect}; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
    next();
  });
  app.get('/camera-ai-demo/config',(req,res) => publicConfig ? res.json(publicConfig) : res.sendStatus(503));
  app.get('/camera-ai-demo/app.js',(req,res) => res.sendFile(path.join(__dirname,'demo.js')));
  app.get('/camera-ai-demo',(req,res) => res.sendFile(path.join(__dirname,'demo.html')));
  const worker = startWorker(env);
  return worker;
}
module.exports = { installCameraAI };
