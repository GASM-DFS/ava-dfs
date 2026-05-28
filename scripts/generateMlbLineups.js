#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS GASM Engine: MLB MME Orchestrator
 * 
 * Usage:
 *   node scripts/generateMlbLineups.js --slate <absolute-path|/dev/stdin> \
 *                                      [--project <project-id>] \
 *                                      [--dataset <dataset-id>] \
 *                                      [--location <region>] \
 *                                      [--endpoint-id <vertex-endpoint-id>] \
 *                                      [--n 20] [--mock <absolute-path>]
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

  // 1. Load the DK MLB Classic slate
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
      
      const floor = parseFloat(pred.Floor) || 0;
      const median = parseFloat(pred.Median) || 0;
      const ceiling = parseFloat(pred.Ceiling) || 0;
      
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
    const contest = getContest('dk-mlb-classic');
    if (!contest) die('Contest configuration "dk-mlb-classic" not found.');

    const portfolio = buildPortfolio(playerPool, contest, {
      n,
      mode: 'gpp',
      maxExposure: 0.40 // 40% strict max exposure for MME constraints
    });

    if (!portfolio.lineups || portfolio.lineups.length === 0) {
      die('Solver failed to generate any valid lineups. Check constraints and player pool.');
    }
    process.stderr.write(`✅ Successfully built ${portfolio.lineups.length} valid MLB lineups.\n`);

    // 5. Output strictly formatted DraftKings CSV
    const headers = contest.rosterSlots;
    process.stdout.write(headers.join(',') + '\n');

    portfolio.lineups.forEach(lineup => {
      // Use a shallow copy to handle multi-slot arrays cleanly (e.g. 3 OFs)
      const pool = [...lineup.players];
      const row = headers.map(slot => {
        const idx = pool.findIndex(p => p.assignedSlot === slot);
        if (idx === -1) die(`Critical Error: Lineup missing assigned slot ${slot}`);
        const player = pool.splice(idx, 1)[0];
        return player.id; // Only output the numerical IDs for DK bulk import
      });
      process.stdout.write(row.join(',') + '\n');
    });

  } catch (error) {
    die(`Pipeline execution failed: ${error.message}`);
  }
}

main();