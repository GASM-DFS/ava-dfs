#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS GASM Engine: Micro Matchup Advantage CLI Wrapper
 * 
 * Usage:
 *   node scripts/calculateMicroMatchups.js --date <YYYY-MM-DD> --slate <absolute-path|/dev/stdin> \
 *                                          --project <project-id> --dataset <dataset-id> [--mock]
 * 
 * Output:
 *   Writes a strict JSON array of { ID, Name, Opponent, MicroMatchupAdvantage } to stdout.
 */

const { readFileSync } = require('fs');
const path = require('path');
const { getMatchupAdvantages } = require('../services/ingestors/matchups');

function die(msg) {
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(1);
}

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

function validateDate(dateStr) {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) {
    die(`Invalid date format: "${dateStr}". Must be strictly YYYY-MM-DD.`);
  }
}

function loadJson(filePath) {
  try {
    if (filePath === '/dev/stdin') {
      return JSON.parse(readFileSync(0, 'utf8'));
    }
    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch (err) {
    die(`Failed to read or parse JSON from ${filePath}: ${err.message}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.date)  die('--date <YYYY-MM-DD> is required');
  if (!args.slate) die('--slate <absolute-path> or /dev/stdin is required');
  if (args.slate !== '/dev/stdin' && !path.isAbsolute(args.slate)) die('--slate must be an absolute path or /dev/stdin');
  if (!args.mock && (!args.project || !args.dataset)) die('--project and --dataset are required unless --mock is used');

  validateDate(args.date);
  const slate = loadJson(args.slate);

  try {
    const results = await getMatchupAdvantages({
      slate,
      date: args.date,
      project: args.project,
      dataset: args.dataset,
      mock: args.mock
    });
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  } catch (error) {
    die(error.message);
  }
}

main();