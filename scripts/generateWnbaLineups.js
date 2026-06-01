#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS GASM Engine: WNBA MME Orchestrator
 * 
 * Usage:
 *   node scripts/generateWnbaLineups.js --slate <absolute-path|/dev/stdin> \
 *                                       [--project <project-id>] \
 *                                       [--dataset <dataset-id>] \
 *                                       [--location <region>] \
 *                                       [--endpoint-id <vertex-endpoint-id>] \
 *                                       [--contest <contest-id>] \
 *                                       [--mode <gpp|cash>] \
 *                                       [--format <csv|json|pretty>] \
 *                                       [--n 20] [--mock <absolute-path>]
 * 
 * Output:
 *   Writes a strict DraftKings CSV of optimal GPP lineups to stdout.
 */

const { readFileSync } = require('fs');
const path = require('path');
const { getPredictions } = require('../services/models/predict');
const { getContest } = require('../services/optimizer/contests');
const { buildPortfolio } = require('../services/optimizer/portfolio');

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

  if (!args.slate)         die('--slate <absolute-path> or /dev/stdin is required');
  if (!args.mock) {
    if (!args.project)       die('--project is required unless --mock is used');
    if (!args.dataset)       die('--dataset is required unless --mock is used');
    if (!args.location)      die('--location is required (e.g., us-central1) unless --mock is used');
    if (!args['endpoint-id']) die('--endpoint-id is required unless --mock is used');
  }

  const n = args.n ? parseInt(args.n, 10) : 20;
  const contestId = args.contest || 'dk-wnba-classic';
  const mode = args.mode || 'gpp';
  const format = args.format || 'csv';

  // 1. Load the DK WNBA slate
  const slate = loadJson(args.slate);
  if (!Array.isArray(slate)) {
    die('Data contract violation: Slate input must be a JSON array of players.');
  }

  try {
    let predictions;
    if (args.mock) {
      process.stderr.write(`🛠️ Using mocked ML projections from ${args.mock}...\n`);
      predictions = loadJson(args.mock);
    } else {
      // 2. Call Vertex AI for probabilistic projections
      process.stderr.write('🧠 Fetching probabilistic distributions from Vertex AI...\n');
      predictions = await getPredictions({
        project: args.project,
        dataset: args.dataset,
        location: args.location,
        endpointId: args['endpoint-id']
      });
    }

    if (!Array.isArray(predictions)) {
      die('Data contract violation: Vertex AI did not return an array of predictions.');
    }

    // 3. Merge player pool
    process.stderr.write('🔗 Merging slate data with ML projections...\n');
    const playerPool = slate.map(p => {
      const pred = predictions.find(pr => String(pr.ID) === String(p.ID));
      if (!pred) return null;
      
      // Apply 1.5x multiplier for DraftKings Showdown Captain slots
      const multiplier = p.Position === 'CPT' ? 1.5 : 1.0;

      const floor = (parseFloat(pred.Floor) || 0) * multiplier;
      const median = (parseFloat(pred.Median) || 0) * multiplier;
      const ceiling = (parseFloat(pred.Ceiling) || 0) * multiplier;
      
      return {
        id: String(p.ID),
        name: p.Name,
        position: p.Position,
        salary: parseInt(p.Salary, 10),
        team: p.TeamAbbrev,
        projectedPoints: median,
        floor: floor,
        ceiling: ceiling,
        // Derive a standard deviation proxy for the Gaussian sampling in portfolio.js
        projectionStdDev: Math.max((ceiling - floor) / 4, 1)
      };
    }).filter(p => p !== null && p.projectedPoints > 0);

    if (playerPool.length === 0) {
      die('Merged player pool is empty. Check ID matching between slate and predictions.');
    }

    // 4. Generate the Portfolio
    process.stderr.write(`⚙️ Generating ${n}-lineup MME portfolio...\n`);
    const contest = getContest(contestId);
    if (!contest) die(`Contest configuration "${contestId}" not found.`);

    const portfolio = buildPortfolio(playerPool, contest, {
      n,
      mode,
      maxExposure: mode === 'cash' ? 1.0 : 0.40
    });

    if (!portfolio.lineups || portfolio.lineups.length === 0) {
      die('Solver failed to generate any valid lineups. Check constraints and player pool.');
    }
    process.stderr.write(`✅ Successfully built ${portfolio.lineups.length} valid WNBA lineups.\n`);

    // 5. Output results based on requested format
    const headers = contest.rosterSlots;

    if (format === 'json') {
      process.stdout.write(JSON.stringify(portfolio, null, 2) + '\n');
    } else if (format === 'pretty') {
      portfolio.lineups.forEach((lineup, index) => {
        process.stdout.write(`\n🌟 Lineup ${index + 1} 🌟\n`);
        process.stdout.write(`💰 Salary: $${lineup.totalSalary} | 📈 Projected: ${lineup.totalProjected.toFixed(2)} FPTS\n`);
        process.stdout.write(`------------------------------------------------------------\n`);
        
        const pool = [...lineup.players];
        headers.forEach(slot => {
          const idx = pool.findIndex(p => p.assignedSlot === slot);
          if (idx === -1) die(`Critical Error: Lineup missing assigned slot ${slot}`);
          const player = pool.splice(idx, 1)[0];
          process.stdout.write(`${slot.padEnd(5)} | ${player.name.padEnd(25)} | $${player.salary.toString().padEnd(5)} | ${player.projectedPoints.toFixed(2)} FPTS\n`);
        });
        process.stdout.write(`------------------------------------------------------------\n`);
      });
    } else {
      process.stdout.write(headers.join(',') + '\n');
      portfolio.lineups.forEach(lineup => {
        // Use a shallow copy to handle multi-slot arrays cleanly
        const pool = [...lineup.players];
        const row = headers.map(slot => {
          const idx = pool.findIndex(p => p.assignedSlot === slot);
          if (idx === -1) die(`Critical Error: Lineup missing assigned slot ${slot}`);
          const player = pool.splice(idx, 1)[0];
          return player.id; // Only output the numerical IDs for DK bulk import
        });
        process.stdout.write(row.join(',') + '\n');
      });
    }

  } catch (error) {
    die(`Pipeline execution failed: ${error.message}`);
  }
}

main();