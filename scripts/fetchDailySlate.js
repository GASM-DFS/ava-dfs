#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS: External API Slate Ingestor
 * 
 * Usage:
 *   node scripts/fetchDailySlate.js --provider <dk|fd> --sport <nba|mlb|nfl> --date <YYYY-MM-DD>
 * 
 * Output:
 *   Writes a strict JSON array of player slate objects to stdout.
 */

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

  if (!args.provider) die('--provider <dk|fd> is required');
  if (!args.sport)    die('--sport <nba|mlb|nfl> is required');
  if (!args.date)     die('--date <YYYY-MM-DD> is required');
  
  validateDate(args.date);

  // In a production scenario, inject your exact API endpoint and authorization headers via env vars.
  const API_BASE_URL = process.env.SPORTS_API_BASE_URL || 'https://api.example-sports-provider.com/v1';
  const API_KEY      = process.env.SPORTS_API_KEY;

  if (!API_KEY) {
    die('SPORTS_API_KEY environment variable is missing.');
  }

  const endpoint = `${API_BASE_URL}/slates/${args.sport}/${args.provider}?date=${args.date}`;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      die(`Upstream API failed with status ${response.status}: ${response.statusText}`);
    }

    const payload = await response.json();

    // Strict Data Contract Enforcement: Ensure the response contains our expected array
    if (!payload || !Array.isArray(payload.players)) {
      die('Data contract violation: API response missing strictly structured "players" array.');
    }

    // Map to the canonical Ava-DFS raw row format expected by `playerRegistry` downstream.
    const rawRows = payload.players.map(p => ({
      ID: p.provider_id,
      Name: p.display_name,
      Position: p.roster_slots.join('/'),
      Salary: p.salary,
      TeamAbbrev: p.team
    }));

    process.stdout.write(JSON.stringify(rawRows, null, 2) + '\n');
  } catch (error) {
    die(`Network or execution error during slate fetch: ${error.message}`);
  }
}

main();