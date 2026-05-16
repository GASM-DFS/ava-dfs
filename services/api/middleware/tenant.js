'use strict';

const QUOTA_PER_MINUTE = Number(process.env.TENANT_QUOTA_PER_MINUTE) || 60;

/** @type {Map<string, { count: number, windowStart: number }>} */
const tenantCounters = new Map();

/**
 * Tenant isolation middleware.
 * Reads X-Tenant-ID header and:
 *  1. Attaches req.tenant = { id } for downstream handlers.
 *  2. Enforces a per-tenant rolling-window rate limit.
 */
function tenantMiddleware(req, res, next) {
  const tenantId = req.headers['x-tenant-id'] || 'default';
  req.tenant = { id: tenantId };

  const now     = Date.now();
  const counter = tenantCounters.get(tenantId) || { count: 0, windowStart: now };

  if (now - counter.windowStart > 60_000) {
    counter.count       = 0;
    counter.windowStart = now;
  }

  counter.count++;
  tenantCounters.set(tenantId, counter);

  if (counter.count > QUOTA_PER_MINUTE) {
    return res.status(429).json({
      error:          'Rate limit exceeded',
      retryAfterMs:   60_000 - (now - counter.windowStart),
    });
  }

  next();
}

module.exports = { tenantMiddleware };
