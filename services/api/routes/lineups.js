'use strict';

const { Router }                       = require('express');
const { addProbabilisticProjections }  = require('../../inference/projections');
const { solveLineup }                  = require('../../optimizer/solver');
const { buildPortfolio }               = require('../../optimizer/portfolio');
const { logger }                       = require('../../observability/logger');

const router = Router();

/**
 * POST /api/v1/lineups/single
 * Body: { players: object[], contest: object }
 * Response: { status, lineup }
 */
router.post('/lineups/single', (req, res) => {
  try {
    const { players, contest } = req.body;
    if (!Array.isArray(players) || !contest) {
      return res.status(400).json({ error: '"players" (array) and "contest" (object) are required' });
    }

    const projected = addProbabilisticProjections(players);
    const lineup    = solveLineup(projected, contest);
    if (!lineup) {
      return res.status(422).json({ error: 'No valid lineup found — check player pool and salary cap' });
    }

    logger.info({ tenant: req.tenant?.id, totalSalary: lineup.totalSalary }, 'Single lineup built');
    res.json({ status: 'ok', lineup });
  } catch (err) {
    logger.error({ error: err.message }, 'Single lineup build failed');
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/lineups/portfolio
 * Body: { players: object[], contest: object, options?: { n, maxExposure, mode } }
 * Response: { status, lineups, n, mode, exposureReport, meta }
 */
router.post('/lineups/portfolio', (req, res) => {
  try {
    const { players, contest, options = {} } = req.body;
    if (!Array.isArray(players) || !contest) {
      return res.status(400).json({ error: '"players" (array) and "contest" (object) are required' });
    }

    const projected = addProbabilisticProjections(players);
    const portfolio = buildPortfolio(projected, contest, options);

    logger.info({ tenant: req.tenant?.id, lineups: portfolio.n }, 'Portfolio built');
    res.json({ status: 'ok', ...portfolio });
  } catch (err) {
    logger.error({ error: err.message }, 'Portfolio build failed');
    res.status(500).json({ error: err.message });
  }
});

module.exports = { lineupsRouter: router };
