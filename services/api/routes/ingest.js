'use strict';

const { Router }         = require('express');
const { ingest }         = require('../../ingest');
const { PlayerRegistry } = require('../../ingest/playerRegistry');
const { logger }         = require('../../observability/logger');

const router   = Router();
const registry = new PlayerRegistry(); // shared registry (persist to DB in production)

/**
 * POST /api/v1/ingest
 * Body: { provider: string, rows: object[], options?: object }
 * Response: { status, players, errors, matchStats }
 */
router.post('/ingest', (req, res) => {
  try {
    const { provider, rows, options = {} } = req.body;
    if (!provider || !Array.isArray(rows)) {
      return res.status(400).json({ error: '"provider" (string) and "rows" (array) are required' });
    }

    const result = ingest(provider, rows, options, registry);
    logger.info({ tenant: req.tenant?.id, provider, ...result.matchStats }, 'Ingest completed');

    res.json({
      status:     'ok',
      players:    result.players.length,
      errors:     result.errors.length,
      matchStats: result.matchStats,
    });
  } catch (err) {
    logger.error({ error: err.message }, 'Ingest failed');
    res.status(500).json({ error: err.message });
  }
});

module.exports = { ingestRouter: router, registry };
