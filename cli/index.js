#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS CLI
 *
 * Usage:
 *   node cli/index.js lineup    --provider <dk|fd> --file <absolute-path> [--contest <path>]
 *   node cli/index.js portfolio --provider <dk|fd> --file <absolute-path> [--contest <path>]
 *                               [--n <count>] [--mode <cash|gpp>] [--max-exposure <0-1>]
 *   node cli/index.js backtest  --provider <dk|fd> --file <absolute-path> --projections <absolute-path> --actuals <absolute-path>
 *
 * --file must be an absolute path to the slate JSON, or /dev/stdin.
 * --projections must be an absolute path to the projections JSON, or /dev/stdin.
 * --sentiment is an optional absolute path to the sentiment JSON.
 * No auto-discovery of files from the home directory.
 */

const { readFileSync } = require('fs');
const path             = require('path');

const { ingest }                      = require('../services/ingest');
const { PlayerRegistry }              = require('../services/ingest/playerRegistry');
const { solveLineup }                 = require('../services/optimizer/solver');
const { buildPortfolio }              = require('../services/optimizer/portfolio');
const { getContest }                  = require('../services/optimizer/contests');

const DEFAULT_DK_NBA_CONTEST = {
  id:          'dk-nba-cli',
  provider:    'draftkings',
  sport:       'nba',
  salaryCap:   50000,
  rosterSlots: ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'],
  type:        'gpp',
  maxPlayersPerTeam: 3,
};

const HELP = `
Ava-DFS CLI

Commands:
  lineup      Build a single optimal lineup
  portfolio   Build a portfolio of N lineups
  backtest    Evaluate a portfolio against actual box scores

Required:
  --provider <dk|fd>        Data provider
  --file <path>             Absolute path to player data JSON file, or /dev/stdin
  --projections <path>      Absolute path to Vertex AI projections JSON, or /dev/stdin
  --sentiment <path>        Optional path to sentiment/injury JSON to filter high-risk players

Optional:
  --contest <path>          Path to contest config JSON file
  --contest-id <string>     Internal registry ID (e.g., dk-nba-classic, dk-mlb-classic)
  --actuals <path>          Absolute path to actual box scores JSON (for backtesting)
  --n <number>              Number of lineups for portfolio (default: 20)
  --mode <cash|gpp>         Optimization mode (default: gpp)
  --max-exposure <0-1>      Max player exposure fraction (default: 0.5)
  --max-team <number>       Max players from the same team (default: 3)
  --no-correlations         Disable sport-specific correlation stacking
  --locked <ids>            Comma-separated player IDs to force into the lineup (Late Swap)
  --excluded <ids>          Comma-separated player IDs to exclude completely
`.trim();

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')
        ? argv[++i]
        : true;
    }
  }
  return args;
}

function loadJson(filePath) {
  if (filePath === '/dev/stdin') {
    return JSON.parse(readFileSync(0, 'utf8'));
  }
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  return JSON.parse(readFileSync(abs, 'utf8'));
}

function die(msg) {
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(1);
}

function main() {
  const [,, command, ...rest] = process.argv;

  if (!command || command === '--help' || command === '-h') {
    console.log(HELP);
    process.exit(0);
  }

  const args = parseArgs(rest);

  if (!args.provider)              die('--provider is required');
  if (!args.file)                  die('--file <absolute-path> or /dev/stdin is required');
  if (args.file !== '/dev/stdin' && !path.isAbsolute(args.file)) die('--file must be an absolute path or /dev/stdin (no auto-discovery)');
  if (!args.projections)           die('--projections <absolute-path> or /dev/stdin is required');
  if (args.projections !== '/dev/stdin' && !path.isAbsolute(args.projections)) die('--projections must be an absolute path or /dev/stdin');

  const rawRows = loadJson(args.file);
  const projRows = loadJson(args.projections);
  const sentimentRows = args.sentiment ? loadJson(args.sentiment) : [];
  
  let contest = DEFAULT_DK_NBA_CONTEST;
  if (args.contest) {
    contest = loadJson(args.contest);
  } else if (args['contest-id']) {
    contest = getContest(args['contest-id']);
    if (!contest) die(`Contest config for ID "${args['contest-id']}" not found.`);
  }

  if (args['max-team']) {
    contest.maxPlayersPerTeam = Number(args['max-team']);
  }

  // Inject sport-specific correlation rules if not explicitly disabled
  if (!args['no-correlations'] && !contest.correlations) {
    const SPORT_CORRELATIONS = {
      nba: [{ primary: 'PG', secondary: 'C' }],
      nfl: [{ primary: 'QB', secondary: 'WR' }]
    };
    contest.correlations = SPORT_CORRELATIONS[contest.sport?.toLowerCase()] || [];
  }

  const registry                    = new PlayerRegistry();
  const { players, errors, matchStats } = ingest(args.provider, rawRows, {}, registry);

  process.stderr.write(
    `Ingest: ${players.length} players, ${errors.length} errors, ` +
    `match rate ${(matchStats.matchRate * 100).toFixed(1)}%\n`
  );

  // Build a fast lookup map for projections by player ID
  const projMap = new Map();
  projRows.forEach(p => projMap.set(String(p.ID), p));

  // Strictly join the daily slate players with their Vertex AI projections
  const projected = players.map(p => {
    const proj = projMap.get(String(p.id));
    if (!proj) {
      process.stderr.write(`⚠️ Warning: No projection found for ${p.name} (ID: ${p.id}).\n`);
    }
    return {
      ...p,
      fpts: proj ? proj.ProjMedian : 0,
      floor: proj ? proj.ProjFloor : 0,
      ceiling: proj ? proj.ProjCeiling : 0
    };
  });

  // Pre-solver check: Filter out players with a high InjuryRisk (>= 0.5)
  let finalPool = projected;
  if (sentimentRows.length > 0) {
    const sentimentMap = new Map();
    sentimentRows.forEach(r => sentimentMap.set(r.Name, r));
    
    finalPool = projected.filter(p => {
      const s = sentimentMap.get(p.name || p.Name);
      if (s && s.InjuryRisk >= 0.5) {
        process.stderr.write(`🏥 Dropping ${p.name || p.Name} due to high InjuryRisk (${s.InjuryRisk}): ${s.Narrative}\n`);
        return false; // Remove from eligible pool
      }
      return true;
    });
  }

  const lockedIds   = args.locked ? String(args.locked).split(',').map(s => s.trim()) : [];
  const excludedIds = args.excluded ? String(args.excluded).split(',').map(s => s.trim()) : [];

  if (command === 'lineup') {
    const lineup = solveLineup(finalPool, contest, { lockedIds, excludedIds });
    if (!lineup) die('No valid lineup found — check player pool and contest config');
    console.log(JSON.stringify(lineup, null, 2));

  } else if (command === 'portfolio') {
    const n           = Number(args.n)              || 20;
    const mode        = args.mode                   || 'gpp';
    const maxExposure = Number(args['max-exposure']) || 0.5;
    const portfolio   = buildPortfolio(finalPool, contest, { n, mode, maxExposure, lockedIds, excludedIds });
    console.log(JSON.stringify(portfolio, null, 2));

  } else if (command === 'backtest') {
    if (!args.actuals) die('--actuals <absolute-path> is required for backtesting');
    const actualRows = loadJson(args.actuals);
    
    // Create a fast lookup map for actual box scores
    const actualsMap = new Map();
    actualRows.forEach(r => actualsMap.set(String(r.ID || r.id || r.PlayerID), r));

    const n           = Number(args.n)              || 20;
    const mode        = args.mode                   || 'gpp';
    const maxExposure = Number(args['max-exposure']) || 0.5;
    const portfolio   = buildPortfolio(finalPool, contest, { n, mode, maxExposure });

    let totalProjected = 0;
    let totalActual = 0;

    // Grade the portfolio against reality
    portfolio.lineups = portfolio.lineups.map(lineup => {
      let lineupActual = 0;
      const evaluatedPlayers = lineup.players.map(p => {
        const actual = actualsMap.get(String(p.id));
        let fpts = actual ? parseFloat(actual.FPTS || actual.fpts || actual.FantasyPoints || actual.FantasyPointsDK || actual.DraftKingsFantasyPoints || actual.score || 0) : 0;
        
        // Apply DraftKings Captain 1.5x multiplier if assigned to CPT in showdown
        if (p.assignedSlot === 'CPT' || p.position === 'CPT') {
          fpts *= 1.5;
        }

        lineupActual += fpts;
        return { ...p, actualFpts: fpts };
      });
      
      const proj = lineup.totalProjection || lineup.projected || 0;
      totalProjected += proj;
      totalActual += lineupActual;
      
      return { ...lineup, players: evaluatedPlayers, projected: proj, actual: lineupActual };
    });

    portfolio.backtest = {
      averageProjected: Number((totalProjected / n).toFixed(2)),
      averageActual: Number((totalActual / n).toFixed(2)),
      totalLineups: n
    };

    console.log(JSON.stringify(portfolio, null, 2));

  } else {
    die(`Unknown command: "${command}". Run with --help for usage.`);
  }
}

main();
