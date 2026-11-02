// Keep parser errors separate from server failures; never echo request bodies.
function jsonErrorHandler(error, req, res, next) {
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Invalid JSON body' });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Request body is too large' });
  }
  return next(error);
}

module.exports = jsonErrorHandler;
