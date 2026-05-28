#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS GASM Engine: Vertex AI Inference CLI Wrapper
 * 
 * Usage:
 *   node scripts/predictProjections.js --project <project-id> --dataset <dataset-id> \
 *                                      --location <region> --endpoint-id <vertex-endpoint-id>
 * 
 * Output:
 *   Writes a strict JSON array of probabilistic projections (Floor, Median, Ceiling) to stdout.
 */

const { getPredictions } = require('../services/models/predict');

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

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.project)       die('--project is required');
  if (!args.dataset)       die('--dataset is required');
  if (!args.location)      die('--location is required (e.g., us-central1)');
  if (!args['endpoint-id']) die('--endpoint-id is required (Vertex AI Endpoint ID)');

  try {
    const predictions = await getPredictions({
      project: args.project,
      dataset: args.dataset,
      location: args.location,
      endpointId: args['endpoint-id']
    });

    process.stdout.write(JSON.stringify(predictions, null, 2) + '\n');
  } catch (error) {
    die(error.message);
  }
}

main();