#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS: Circadian Fatigue Index (CFI) CLI Wrapper
 * 
 * Usage:
 *   node scripts/calculateFatigue.js --date <YYYY-MM-DD> --file <absolute-path|/dev/stdin>
 * 
 * Output:
 *   Writes a strict JSON array of { Team, GameDate, CircadianFatigueIndex } to stdout.
 */

const { readFileSync } = require('fs');
const path = require('path');
const { calculateCircadianFatigue } = require('../services/ingestors/fatigue');

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

  if (!args.date) die('--date <YYYY-MM-DD> is required');
  if (!args.file) die('--file <absolute-path> or /dev/stdin is required');
  if (args.file !== '/dev/stdin' && !path.isAbsolute(args.file)) die('--file must be an absolute path or /dev/stdin');

  validateDate(args.date);

  const schedule = loadJson(args.file);

  try {
    const results = calculateCircadianFatigue({
      schedule,
      targetDate: args.date
    });
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  } catch (error) {
    die(error.message);
  }
}

main();