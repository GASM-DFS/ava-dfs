'use strict';

/**
 * Ava-DFS: Optimizer API Gateway
 * Exposes the internal PuLP/ILP solver logic as a stateless REST endpoint.
 */

const express = require('express');
const { buildPortfolio } = require('../services/optimizer/portfolio');
const { getContest } = require('../services/optimizer/contests');

const app = express();

// Increase JSON payload limit to cleanly accept large slate projections arrays
app.use(express.json({ limit: '10mb' }));

// Liveness probe for GCP Cloud Run
app.get('/health', (req, res) => res.status(200).json({ status: 'healthy', service: 'ava-dfs-optimizer' }));

app.post('/api/v1/optimize', (req, res) => {
  try {
    const { players, contestId, settings = {} } = req.body;

    // 1. Strict Data Contract Validations
    if (!players || !Array.isArray(players)) {
      return res.status(400).json({ error: 'Data contract violation: "players" must be an array of projected player objects.' });
    }
    if (!contestId) {
      return res.status(400).json({ error: 'Data contract violation: "contestId" (e.g., "dk-nba-classic") is required.' });
    }

    const contest = getContest(contestId);
    if (!contest) {
      return res.status(404).json({ error: `Contest configuration "${contestId}" not found in registry.` });
    }

    // 2. Extract and sanitize constraints
    const n = parseInt(settings.n, 10) || 20;
    const maxExposure = parseFloat(settings.maxExposure) || 0.40;
    const mode = settings.mode === 'cash' ? 'cash' : 'gpp';
    const lockedIds = Array.isArray(settings.lockedIds) ? settings.lockedIds.map(String) : [];
    const excludedIds = Array.isArray(settings.excludedIds) ? settings.excludedIds.map(String) : [];

    // 3. Execute Solver
    const portfolio = buildPortfolio(players, contest, {
      n,
      maxExposure,
      mode,
      lockedIds,
      excludedIds
    });

    if (!portfolio || !portfolio.lineups || portfolio.lineups.length === 0) {
      return res.status(422).json({ error: 'Solver failed to generate any valid lineups. Check constraints (e.g., too many locks) and player pool.' });
    }

    return res.status(200).json(portfolio);
  } catch (error) {
    process.stderr.write(`[API Critical Error]: ${error.stack}\n`);
    return res.status(500).json({ error: `Pipeline execution failed: ${error.message}` });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => process.stdout.write(`🚀 Ava-DFS API Gateway listening on port ${PORT}\n`));