'use strict';

const { Router }                      = require('express');
const { getSlate, getProjections }    = require('../../data/bigquery');
const { addProbabilisticProjections } = require('../../inference/projections');
const { solveLineup }                 = require('../../optimizer/solver');
const { buildPortfolio }              = require('../../optimizer/portfolio');
const { getContest }                  = require('../../optimizer/contests');
const { logger }                      = require('../../observability/logger');

const router = Router();

const DATE_RE        = /^\d{4}-\d{2}-\d{2}$/;
const SUPPORTED_SPORTS = new Set(['mlb', 'nba']);

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function validateSport(sport, res) {
  if (!SUPPORTED_SPORTS.has(sport)) {
    res.status(400).json({ error: `Unsupported sport "${sport}". Supported: ${[...SUPPORTED_SPORTS].join(', ')}` });
    return false;
  }
  return true;
}

function validateDate(date, res) {
  if (!DATE_RE.test(date)) {
    res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    return false;
  }
  return true;
}

// ── Slate ──────────────────────────────────────────────────────────────────

async function handleSlate(req, res, sport, date) {
  if (!validateSport(sport, res)) return;
  if (!validateDate(date, res)) return;
  try {
    const raw      = await getSlate(sport, date);
    const enriched = addProbabilisticProjections(raw);
    logger.info({ tenant: req.tenant?.id, sport, date, count: enriched.length }, 'Slate fetched');
    res.json({ sport, date, count: enriched.length, generatedAt: new Date().toISOString(), players: enriched });
  } catch (err) {
    logger.error({ error: err.message, sport, date }, 'Slate fetch failed');
    res.status(500).json({ error: err.message });
  }
}

router.get('/slate/:sport', async (req, res) => {
  await handleSlate(req, res, req.params.sport.toLowerCase(), todayUtc());
});

router.get('/slate/:sport/:date', async (req, res) => {
  await handleSlate(req, res, req.params.sport.toLowerCase(), req.params.date);
});

// ── Projections ────────────────────────────────────────────────────────────

async function handleProjections(req, res, sport, date) {
  if (!validateSport(sport, res)) return;
  if (!validateDate(date, res)) return;
  try {
    const projections = await getProjections(sport, date);
    res.json({ sport, date, count: projections.length, projections });
  } catch (err) {
    logger.error({ error: err.message }, 'Projections fetch failed');
    res.status(500).json({ error: err.message });
  }
}

router.get('/projections/:sport', async (req, res) => {
  await handleProjections(req, res, req.params.sport.toLowerCase(), todayUtc());
});

router.get('/projections/:sport/:date', async (req, res) => {
  await handleProjections(req, res, req.params.sport.toLowerCase(), req.params.date);
});

// ── Optimize ───────────────────────────────────────────────────────────────

async function handleOptimize(req, res, sport, date) {
  if (!validateSport(sport, res)) return;
  if (!validateDate(date, res)) return;

  const contestId   = req.query.contest  || `dk-${sport}-classic`;
  const n           = Math.min(Number(req.query.n || 1), 150);
  const mode        = req.query.mode === 'cash' ? 'cash' : 'gpp';
  const lockedIds   = req.query.locked   ? req.query.locked.split(',').map(s => s.trim())   : [];
  const excludedIds = req.query.excluded ? req.query.excluded.split(',').map(s => s.trim()) : [];

  const contest = getContest(contestId);
  if (!contest) {
    return res.status(400).json({ error: `Unknown contest "${contestId}"` });
  }

  try {
    const raw     = await getSlate(sport, date);
    const players = addProbabilisticProjections(raw);

    let result;
    if (n === 1) {
      const lineup = solveLineup(players, contest, { lockedIds, excludedIds });
      if (!lineup) return res.status(422).json({ error: 'No valid lineup found — check player pool and salary cap' });
      result = { lineups: [lineup], n: 1 };
    } else {
      result = buildPortfolio(players, contest, { n, mode, lockedIds, excludedIds });
    }

    logger.info({ tenant: req.tenant?.id, sport, date, contestId, n }, 'Lineups optimized');
    res.json({ sport, date, contest: contestId, mode, generatedAt: new Date().toISOString(), ...result });
  } catch (err) {
    logger.error({ error: err.message, sport, date, contestId }, 'Optimization failed');
    res.status(500).json({ error: err.message });
  }
}

router.get('/optimize/:sport', async (req, res) => {
  await handleOptimize(req, res, req.params.sport.toLowerCase(), todayUtc());
});

router.get('/optimize/:sport/:date', async (req, res) => {
  await handleOptimize(req, res, req.params.sport.toLowerCase(), req.params.date);
});

module.exports = { slateRouter: router };
