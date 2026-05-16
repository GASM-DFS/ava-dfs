'use strict';

/**
 * API key authentication middleware.
 *
 * Set API_KEYS env var to a comma-separated list of valid keys.
 * Set API_KEYS=* to disable auth (development only — never use in production).
 */
function authMiddleware(req, res, next) {
  if (process.env.API_KEYS === '*') return next(); // dev bypass

  const validKeys = new Set(
    (process.env.API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean)
  );

  if (validKeys.size === 0) {
    return res.status(503).json({ error: 'Service not configured: no API_KEYS set' });
  }

  const provided = req.headers['x-api-key'] || req.query.api_key;
  if (!provided || !validKeys.has(provided)) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing API key' });
  }

  next();
}

module.exports = { authMiddleware };
