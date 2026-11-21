// Standalone module: the application owner must explicitly register it.
// Start portal CSP in report-only mode while legacy inline handlers/styles migrate.
function createPortalSecurityHeaders({
  portalCspMode = 'report-only',
  supabaseOrigin = 'https://yzhxjzbzslnveskkwvfy.supabase.co',
  inlineStyleHashes = [],
} = {}) {
  if (!['report-only', 'enforce'].includes(portalCspMode)) {
    throw new Error('Invalid portal CSP mode');
  }
  const project = new URL(supabaseOrigin);
  if (project.protocol !== 'https:' || project.username || project.password ||
      project.pathname !== '/' || project.search || project.hash) {
    throw new Error('Supabase origin must be an HTTPS origin without credentials or a path');
  }
  if (!Array.isArray(inlineStyleHashes) || inlineStyleHashes.some(hash =>
    typeof hash !== 'string' || !/^sha256-[A-Za-z0-9+/]{43}=$/.test(hash))) {
    throw new Error('Invalid trusted inline style hashes');
  }
  const baseline = "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'";
  const strictPolicy = [
    "default-src 'none'",
    "script-src 'self' https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
    "script-src-attr 'none'",
    ["style-src 'self' https://fonts.googleapis.com https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
      ...inlineStyleHashes.map(hash => `'${hash}'`)].join(' '),
    "style-src-attr 'none'",
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: blob: ${project.origin} https://server.arcgisonline.com https://unpkg.com/leaflet@1.9.4/dist/images/`,
    `connect-src 'self' ${project.origin} wss://${project.host}`,
    "media-src 'self' blob:",
    "frame-src 'none'",
    "worker-src 'none'",
    baseline,
  ].join('; ');

  return function portalSecurityHeaders(req, res, next) {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    // req.secure comes from Express's configured proxy trust, not a raw header.
    // No includeSubDomains/preload commitment is made for the Render parent domain.
    if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
    const isPortal = req.path === '/portal' || req.path.startsWith('/portal/');
    if (isPortal) {
      if (portalCspMode === 'enforce') res.set('Content-Security-Policy', strictPolicy);
      else res.set('Content-Security-Policy-Report-Only', strictPolicy);
    } else {
      res.set('Content-Security-Policy', "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'");
    }
    next();
  };
}

module.exports = { createPortalSecurityHeaders };
