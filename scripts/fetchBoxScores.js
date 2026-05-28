#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS: External API Box Score CLI Wrapper
 * 
 * Usage:
 *   node scripts/fetchBoxScores.js --provider <provider-name> --sport <nba|mlb|nfl> --date <YYYY-MM-DD> [--mock]
 * 
 * Output:
 *   Writes a strict JSON array of actual player box score objects to stdout.
 */

const { getBoxScores } = require('../services/ingestors/boxscores');

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

/**
 * Validates the date string conforms to strict YYYY-MM-DD format.
 */
function validateDate(dateStr) {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) {
    die(`Invalid date format: "${dateStr}". Must be strictly YYYY-MM-DD.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.provider) die('--provider <provider-name> is required');
  if (!args.sport)    die('--sport <nba|mlb|nfl> is required');
  if (!args.date)     die('--date <YYYY-MM-DD> is required (date the games were played)');
  
  validateDate(args.date);

  try {
    const results = await getBoxScores({
      provider: args.provider,
      sport: args.sport,
      date: args.date,
      mock: args.mock
    });
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  } catch (error) {
    die(`Execution error during box score fetch: ${error.message}`);
  }
}

main();