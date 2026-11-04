const sharedReadPaths = new Set(['/readings/history', '/readings', '/latest', '/alerts', '/alerts/live']);
const staffReadRoles = new Set(['officer', 'botanist', 'researcher']);

// Authentication at the server mount supplies the verified database profile.
// Every other IoT path stays Officer-only, including future management routes.
module.exports = function iotAccess(req, res, next) {
  if (!req.profile) return res.status(401).json({ message: 'Bearer token required' });
  const sharedRead = (req.method === 'GET' || req.method === 'HEAD') && sharedReadPaths.has(req.path);
  const allowed = sharedRead ? staffReadRoles.has(req.profile.role) : req.profile.role === 'officer';
  if (req.profile.account_status !== 'active' || !allowed) {
    return res.status(403).json({ message: 'Insufficient permissions' });
  }
  return next();
};
