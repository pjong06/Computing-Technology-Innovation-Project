// Process-local fixed windows; deploy/restart resets quotas. Use a shared store
// before scaling to multiple backend instances.
function createIdentifyRateLimit({ limit, keyFor, windowMs = 60000, maxClients = 10000, now = Date.now }) {
  if (![limit, windowMs, maxClients].every(n => Number.isSafeInteger(n) && n > 0)) {
    throw new Error('Invalid identification rate policy');
  }
  const clients = new Map();
  return (req, res, next) => {
    const time = now();
    for (const [key, bucket] of clients) {
      if (bucket.until <= time) clients.delete(key);
    }
    res.set('Cache-Control', 'no-store');
    const key = keyFor(req);
    let bucket = clients.get(key);
    if (!bucket) {
      if (clients.size >= maxClients) {
        res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
        return res.status(503).json({ success: false, message: 'Please retry later.' });
      }
      bucket = { count: 0, until: time + windowMs };
      clients.set(key, bucket);
    }
    if (bucket.count >= limit) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.until - time) / 1000))));
      return res.status(429).json({ success: false, message: 'Too many identification requests. Please retry later.' });
    }
    bucket.count++;
    return next();
  };
}

module.exports = { createIdentifyRateLimit };
