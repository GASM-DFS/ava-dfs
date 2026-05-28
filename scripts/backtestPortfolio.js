#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS GASM Engine: MME Backtesting Evaluator
 * 
 * Usage:
 *   node scripts/backtestPortfolio.js --csv <path-to-lineups.csv> --actuals <path-to-boxscores.json> [--json] [--date YYYY-MM-DD] [--sport wnba]
 * 
 * Outputs:
 *   A terminal report detailing the Actual FPTS scored by each simulated lineup, 
 *   including Max, Min, Portfolio Average, and Best Lineup Composition.
 */

const { readFileSync } = require('fs');
const path = require('path');

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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.csv) die('--csv <path> is required (the generated lineups CSV)');
  if (!args.actuals) die('--actuals <path> is required (the real box scores JSON)');

  const csvPath = path.isAbsolute(args.csv) ? args.csv : path.resolve(process.cwd(), args.csv);
  const actualsPath = path.isAbsolute(args.actuals) ? args.actuals : path.resolve(process.cwd(), args.actuals);

  let csvData;
  try {
    csvData = readFileSync(csvPath, 'utf8').trim().split('\n');
  } catch (e) {
    die(`Failed to read CSV: ${e.message}`);
  }

  let actuals;
  try {
    actuals = JSON.parse(readFileSync(actualsPath, 'utf8'));
  } catch (e) {
    die(`Failed to read Actuals JSON: ${e.message}`);
  }

  // Build quick lookup for actual points by Player ID
  // Defensively handles various API schemas (Native vs SportsData.io)
  const actualsMap = new Map();
  actuals.forEach(p => {
    const id = String(p.ID || p.playerId || p.OperatorPlayerID || p.PlayerID);
    const fpts = parseFloat(p.FPTS || p.FantasyPoints || p.DraftKingsFantasyPoints || p.score || 0);
    if (id && !isNaN(fpts)) actualsMap.set(id, fpts);
  });

  // Parse strictly formatted DK CSV
  const headers = csvData[0].split(',');
  const lineups = csvData.slice(1).map(row => row.split(','));

  let maxScore = -Infinity;
  let minScore = Infinity;
  let totalScore = 0;
  let bestLineup = null;

  const results = lineups.map((lineup, idx) => {
    let score = 0;
    let missing = 0;
    const roster = [];

    lineup.forEach((playerId, slotIdx) => {
      const id = String(playerId).trim();
      if (!id) return;
      const points = actualsMap.get(id);
      
      if (points !== undefined) {
        score += points;
        roster.push(`${headers[slotIdx]}:${id} (${points.toFixed(1)} FPTS)`);
      } else {
        missing++;
        roster.push(`${headers[slotIdx]}:${id} (⚠️ MISSING)`);
      }
    });

    if (score > maxScore) {
      maxScore = score;
      bestLineup = { idx: idx + 1, score, roster };
    }
    if (score < minScore) minScore = score;
    totalScore += score;

    return { idx: idx + 1, score, missing };
  });

  // Sort and display top 5
  results.sort((a, b) => b.score - a.score);
  
  // Strict Data Contract: If --json is passed, output BQ ingestion payload and exit
  if (args.json) {
    const record = {
      GameDate: args.date || new Date().toISOString().split('T')[0],
      Sport: (args.sport || 'UNKNOWN').toUpperCase(),
      LineupsEvaluated: lineups.length,
      MaxScore: maxScore !== -Infinity ? parseFloat(maxScore.toFixed(2)) : 0,
      MinScore: minScore !== Infinity ? parseFloat(minScore.toFixed(2)) : 0,
      AvgScore: lineups.length > 0 ? parseFloat((totalScore / lineups.length).toFixed(2)) : 0,
      BestLineupRoster: bestLineup ? bestLineup.roster.join(' | ') : null
    };
    process.stdout.write(JSON.stringify([record], null, 2) + '\n');
    return;
  }

  process.stdout.write(`\n📊 Ava-DFS Backtest Report\n`);
  process.stdout.write(`==================================\n`);
  process.stdout.write(`Lineups Evaluated: ${lineups.length}\n\n`);

  process.stdout.write(`🏆 Top 5 Lineups by Actual FPTS:\n`);
  results.slice(0, 5).forEach(r => {
    process.stdout.write(`  Lineup #${r.idx.toString().padStart(2, ' ')}: ${r.score.toFixed(2)} FPTS ${r.missing > 0 ? `(⚠️ ${r.missing} missing actuals)` : ''}\n`);
  });

  process.stdout.write(`\n📈 Portfolio Summary:\n`);
  process.stdout.write(`  Max Score: ${maxScore.toFixed(2)}\n`);
  process.stdout.write(`  Avg Score: ${(totalScore / lineups.length).toFixed(2)}\n`);
  process.stdout.write(`  Min Score: ${minScore.toFixed(2)}\n\n`);
  
  if (bestLineup) {
    process.stdout.write(`🔥 Best Lineup Breakdown (Lineup #${bestLineup.idx}):\n`);
    bestLineup.roster.forEach(p => process.stdout.write(`  - ${p}\n`));
  }
  process.stdout.write(`==================================\n\n`);
}

main();