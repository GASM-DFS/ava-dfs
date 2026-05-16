'use strict';

const { createServer } = require('./services/api/server');
const { logger }       = require('./services/observability/logger');

const port = process.env.PORT || 8080;
createServer().listen(port, () => {
  logger.info({ port }, 'Ava-DFS service started');
});
