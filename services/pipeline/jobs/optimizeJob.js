'use strict';

const { buildPortfolio } = require('../../optimizer/portfolio');
const { metrics }        = require('../../observability/metrics');

/**
 * Pipeline job: run the portfolio optimizer and hard-fail if no lineups are produced.
 */
function createOptimizeJob(contestConfig, portfolioOptions = {}) {
  return {
    name: 'optimize',
    async run(ctx) {
      const players = ctx.inference?.players || ctx.featureBuild?.players || ctx.players || [];

      const start     = Date.now();
      const portfolio = buildPortfolio(players, contestConfig, portfolioOptions);
      const duration  = Date.now() - start;

      metrics.histogram('optimize.duration',      duration);
      metrics.gauge('optimize.lineups.count', portfolio.lineups.length);

      if (portfolio.lineups.length === 0) {
        throw new Error(
          'Optimizer produced zero lineups — check player pool size and contest constraints.'
        );
      }

      return portfolio;
    },
  };
}

module.exports = { createOptimizeJob };
