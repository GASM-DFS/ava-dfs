#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS: Micro Matchup Advantage Calculator
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
const { BigQuery } = require('@google-cloud/bigquery');

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

  if (!Array.isArray(slate)) {
    die('Data contract violation: --slate input must be a JSON array of players.');
  }

  let matchupData = {}; // Map of TeamAbbrev -> { Opponent, DvP_Modifiers: {} }

  if (args.mock) {
    // Generate mock Defense vs Position (DvP) and matchup data for testing
    matchupData = {
      "LAL": { Opponent: "NYK", DvP_Modifiers: { "PG": 1.15, "SG": 0.95, "SF": 1.00, "PF": 1.05, "C": 0.80 } },
      "NYK": { Opponent: "LAL", DvP_Modifiers: { "PG": 0.85, "SG": 1.10, "SF": 0.90, "PF": 1.15, "C": 1.05 } },
      "MIA": { Opponent: "BOS", DvP_Modifiers: { "PG": 1.00, "SG": 1.00, "SF": 0.95, "PF": 0.95, "C": 1.20 } },
      "BOS": { Opponent: "MIA", DvP_Modifiers: { "PG": 0.90, "SG": 0.85, "SF": 1.05, "PF": 1.10, "C": 0.90 } }
    };
  } else {
    const bigquery = new BigQuery({ projectId: args.project });
    
    // In production, we query the `defense_vs_position` table documented in Ava.md
    // This query assumes a table schema mapping today's matchups to defensive efficiency multipliers
    const query = `
      SELECT 
        Team, 
        Opponent, 
        Def_PG_Multiplier, 
        Def_SG_Multiplier, 
        Def_SF_Multiplier, 
        Def_PF_Multiplier, 
        Def_C_Multiplier 
      FROM \`${args.project}.${args.dataset}.defense_vs_position\`
      WHERE GameDate = @targetDate
    `;
    
    try {
      const [rows] = await bigquery.query({ query, params: { targetDate: args.date } });
      rows.forEach(r => {
        matchupData[r.Team] = {
          Opponent: r.Opponent,
          DvP_Modifiers: {
            "PG": r.Def_PG_Multiplier,
            "SG": r.Def_SG_Multiplier,
            "SF": r.Def_SF_Multiplier,
            "PF": r.Def_PF_Multiplier,
            "C": r.Def_C_Multiplier
          }
        };
      });
    } catch (error) {
      die(`Failed to execute BigQuery SQL for matchups: ${error.message}`);
    }
  }

  const results = slate.map(player => {
    // Extract primary position (e.g., "PG/SG" -> "PG")
    const primaryPos = player.Position ? player.Position.split('/')[0] : 'UTIL';
    
    const teamData = matchupData[player.TeamAbbrev];
    
    // Default to a 1.0 (neutral) modifier if data is missing for this team/position
    let advantage = 1.0;
    let opponent = "UNKNOWN";
    
    if (teamData) {
      opponent = teamData.Opponent;
      advantage = teamData.DvP_Modifiers[primaryPos] || 1.0;
    }

    return {
      ID: player.ID,
      Name: player.Name,
      Opponent: opponent,
      MicroMatchupAdvantage: parseFloat(advantage.toFixed(3))
    };
  });

  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
}

main();