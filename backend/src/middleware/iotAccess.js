const sharedReadPaths = new Set(['/readings/history', '/readings', '/latest', '/alerts', '/alerts/live', '/summary', '/summary/live']);
const staffReadRoles = new Set(['officer', 'botanist', 'researcher']);

// Authentication at the server mount supplies the verified database profile.
// Only the two explicit lifecycle actions are shared writes. Management stays Officer-only.
module.exports = function iotAccess(req, res, next) {
  if (!req.profile) return res.status(401).json({ message: 'Bearer token required' });
  const sharedRead = (req.method === 'GET' || req.method === 'HEAD') && sharedReadPaths.has(req.path);
  const sharedAction = req.method === 'PATCH' && /^\/alerts\/[^/]+\/(acknowledge|resolve)$/.test(req.path);
  const allowed = sharedRead || sharedAction ? staffReadRoles.has(req.profile.role) : req.profile.role === 'officer';
  if (req.profile.account_status !== 'active' || !allowed) {
    return res.status(403).json({ message: 'Insufficient permissions' });
  }
  return next();
};
