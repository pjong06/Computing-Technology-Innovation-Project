const { rateLimit } = require('express-rate-limit');

const DEFAULTS = Object.freeze({ read: 300, photo: 600, write: 60, windowMs: 60_000 });

function positiveInteger(value, fallback, name, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new Error(`${name} is outside the supported range`);
  }
  return parsed;
}

// One limiter per category, shared across all Knowledge paths in that category.
// MemoryStore is process-local: restarts reset counters. Use a shared store
// before running multiple backend instances. IPs behind one NAT share quotas.
function createKnowledgeRateLimit({ env = process.env } = {}) {
  const windowMs = positiveInteger(env.KNOWLEDGE_RATE_WINDOW_MS,
    DEFAULTS.windowMs, 'KNOWLEDGE_RATE_WINDOW_MS', 2_147_483_647);
  const limiters = {};
  for (const category of ['read', 'photo', 'write']) {
    const name = `KNOWLEDGE_${category.toUpperCase()}_RATE_LIMIT`;
    limiters[category] = rateLimit({
      windowMs,
      limit: positiveInteger(env[name], DEFAULTS[category], name),
      standardHeaders: 'draft-6',
      legacyHeaders: false,
      // Keep the library's IP key generator and IPv6 subnet protection.
      // Express req.ip must use the deployment's verified trust-proxy setting.
      handler(_req, res) {
        res.set('Cache-Control', 'no-store');
        return res.status(429).json({
          message: 'Too many Knowledge API requests. Please retry later.',
          code: 'KNOWLEDGE_RATE_LIMITED',
          policy: category,
          retry_after_seconds: Number(res.get('Retry-After')),
        });
      },
    });
  }

  return (req, res, next) => {
    // Preflight and unsupported methods do not consume read/write budgets.
    if (req.method === 'OPTIONS') return next();
    const isRead = req.method === 'GET' || req.method === 'HEAD';
    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    if (!isRead && !isWrite) return next();
    const isPhoto = isRead && /^\/species\/[^/]+\/photos\/[^/]+\/?$/i.test(req.path);
    const category = isPhoto ? 'photo' : isRead ? 'read' : 'write';
    return limiters[category](req, res, next);
  };
}

module.exports = { createKnowledgeRateLimit };
