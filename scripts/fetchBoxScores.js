#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS: External API Box Score Ingestor
 * 
 * Usage:
 *   node scripts/fetchBoxScores.js --provider <provider-name> --sport <nba|mlb|nfl> --date <YYYY-MM-DD>
 * 
 * Output:
 *   Writes a strict JSON array of actual player box score objects to stdout.
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

  if (!args.provider) die('--provider <provider-name> is required');
  if (!args.sport)    die('--sport <nba|mlb|nfl> is required');
  if (!args.date)     die('--date <YYYY-MM-DD> is required (date the games were played)');
  
  validateDate(args.date);

  let payload;

  if (args.mock) {
    // Generate mock data for end-to-end pipeline testing without a real API
    payload = {
      boxscores: [
        {
          provider_player_id: "mock-123",
          display_name: "Mock Player 1",
          minutes: 36.5,
          points: 25,
          rebounds: 8,
          assists: 7,
          steals: 2,
          blocks: 1,
          turnovers: 3,
          dk_points: 52.25
        },
        {
          provider_player_id: "mock-456",
          display_name: "Mock Player 2",
          minutes: 32.0,
          points: 18,
          rebounds: 12,
          assists: 3,
          steals: 1,
          blocks: 3,
          turnovers: 1,
          dk_points: 46.5
        }
      ]
    };
  } else {
    // In a production scenario, inject your exact API endpoint and authorization headers via env vars.
    const API_BASE_URL = process.env.SPORTS_API_BASE_URL || 'https://api.example-sports-provider.com/v1';
    const API_KEY      = process.env.SPORTS_API_KEY;

    if (!API_KEY) {
      die('SPORTS_API_KEY environment variable is missing.');
    }

    const endpoint = `${API_BASE_URL}/boxscores/${args.sport}?date=${args.date}`;

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

      payload = await response.json();
    } catch (error) {
      die(`Network or execution error during box score fetch: ${error.message}`);
    }
  }

  try {
    // Strict Data Contract Enforcement: Ensure the response contains our expected array
    if (!payload || !Array.isArray(payload.boxscores)) {
      die('Data contract violation: API response missing strictly structured "boxscores" array.');
    }

    // Map the external API data to the schema expected by our `fact_box_scores` BigQuery table
    const rawRows = payload.boxscores.map(b => ({
      ID: b.provider_player_id,
      Name: b.display_name,
      GameDate: args.date,
      Minutes: b.minutes || 0.0,
      Points: b.points || 0,
      Rebounds: b.rebounds || 0,
      Assists: b.assists || 0,
      Steals: b.steals || 0,
      Blocks: b.blocks || 0,
      TO: b.turnovers || 0, // This maps to the `TO` column your database expects
      FantasyPointsDK: b.dk_points || 0.0
    }));

    process.stdout.write(JSON.stringify(rawRows, null, 2) + '\n');
  } catch (error) {
    die(`Execution error mapping box score data: ${error.message}`);
  }
}

main();