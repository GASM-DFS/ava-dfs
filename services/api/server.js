'use strict';

const express              = require('express');
const { authMiddleware }   = require('./middleware/auth');
const { tenantMiddleware } = require('./middleware/tenant');
const { healthRouter }     = require('./routes/health');
const { ingestRouter }     = require('./routes/ingest');
const { pipelineRouter }   = require('./routes/pipeline');
const { lineupsRouter }    = require('./routes/lineups');
const { slateRouter }      = require('./routes/slate');
const { logger }           = require('../observability/logger');

function createServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Request logging (all routes)
  app.use((req, _res, next) => {
    logger.info({ method: req.method, path: req.path }, 'Incoming request');
    next();
  });

  // Health + metrics — no auth required
  app.use('/api/v1', healthRouter);

  // All other routes require auth + tenant context
  app.use('/api/v1', authMiddleware, tenantMiddleware);
  app.use('/api/v1', ingestRouter);
  app.use('/api/v1', pipelineRouter);
  app.use('/api/v1', lineupsRouter);
  app.use('/api/v1', slateRouter);

  // Global error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    logger.error({ error: err.message }, 'Unhandled server error');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createServer };
