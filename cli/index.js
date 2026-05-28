#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS CLI
 *
 * Usage:
 *   node cli/index.js lineup    --provider <dk|fd> --file <absolute-path> [--contest <path>]
 *   node cli/index.js portfolio --provider <dk|fd> --file <absolute-path> [--contest <path>]
 *                               [--n <count>] [--mode <cash|gpp>] [--max-exposure <0-1>]
 *
 * --file must be an absolute path to the slate JSON, or /dev/stdin.
 * --projections must be an absolute path to the projections JSON, or /dev/stdin.
 * No auto-discovery of files from the home directory.
 */

const { readFileSync } = require('fs');
const path             = require('path');

const { ingest }                      = require('../services/ingest');
const { PlayerRegistry }              = require('../services/ingest/playerRegistry');
const { solveLineup }                 = require('../services/optimizer/solver');
const { buildPortfolio }              = require('../services/optimizer/portfolio');

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

Required:
  --provider <dk|fd>        Data provider
  --file <path>             Absolute path to player data JSON file, or /dev/stdin
  --projections <path>      Absolute path to Vertex AI projections JSON, or /dev/stdin

Optional:
  --contest <path>          Path to contest config JSON file
  --n <number>              Number of lineups for portfolio (default: 20)
  --mode <cash|gpp>         Optimization mode (default: gpp)
  --max-exposure <0-1>      Max player exposure fraction (default: 0.5)
  --max-team <number>       Max players from the same team (default: 3)
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
  const contest = args.contest ? loadJson(args.contest) : DEFAULT_DK_NBA_CONTEST;

  if (args['max-team']) {
    contest.maxPlayersPerTeam = Number(args['max-team']);
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

  if (command === 'lineup') {
    const lineup = solveLineup(projected, contest);
    if (!lineup) die('No valid lineup found — check player pool and contest config');
    console.log(JSON.stringify(lineup, null, 2));

  } else if (command === 'portfolio') {
    const n           = Number(args.n)              || 20;
    const mode        = args.mode                   || 'gpp';
    const maxExposure = Number(args['max-exposure']) || 0.5;
    const portfolio   = buildPortfolio(projected, contest, { n, mode, maxExposure });
    console.log(JSON.stringify(portfolio, null, 2));

  } else {
    die(`Unknown command: "${command}". Run with --help for usage.`);
  }
}

main();
