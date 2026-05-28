#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS GASM Engine: BigQuery ML XGBoost Training Orchestrator
 * 
 * Usage:
 *   node scripts/trainModel.js --project <project-id> --dataset <dataset-id> --version <version-tag>
 * 
 * Example:
 *   node scripts/trainModel.js --project gasm-481006 --dataset nba_dfs_data --version v1.0.0
 */

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

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.project) die('--project is required');
  if (!args.dataset) die('--dataset is required');
  if (!args.version) die('--version is required (e.g., v1.0.0)');

  const bigquery = new BigQuery({ projectId: args.project });

  // Define the BQML parameters for XGBoost
  const trainQuery = `
    CREATE OR REPLACE MODEL \`${args.project}.${args.dataset}.nba_xgboost_model\`
    OPTIONS(
      MODEL_TYPE='BOOSTED_TREE_REGRESSOR',
      INPUT_LABEL_COLS=['Target_FantasyPointsDK'],
      MAX_ITERATIONS=50,
      DATA_SPLIT_METHOD='AUTO_SPLIT'
    ) AS
    SELECT
      rolling_5g_minutes,
      rolling_5g_points,
      rolling_5g_rebounds,
      rolling_5g_assists,
      rolling_5g_steals,
      rolling_5g_blocks,
      rolling_5g_turnovers,
      Target_FantasyPointsDK
    FROM \`${args.project}.${args.dataset}.gold_player_features\`
    WHERE Target_FantasyPointsDK IS NOT NULL
  `;

  const exportQuery = `
    EXPORT MODEL \`${args.project}.${args.dataset}.nba_xgboost_model\`
    OPTIONS(URI='gs://cloud-ai-platform/models/nba-dfs/${args.version}')
  `;

  try {
    process.stdout.write(`🧠 Training XGBoost Model natively in BigQuery ML...\n`);
    const [trainJob] = await bigquery.createQueryJob({ query: trainQuery });
    process.stdout.write(`⏳ Job ${trainJob.id} started. This may take a few minutes...\n`);
    await trainJob.getQueryResults();
    process.stdout.write('✅ Model successfully trained in BigQuery.\n');

    process.stdout.write(`\n📦 Exporting compiled model.bst to gs://cloud-ai-platform/models/nba-dfs/${args.version}...\n`);
    const [exportJob] = await bigquery.createQueryJob({ query: exportQuery });
    await exportJob.getQueryResults();
    process.stdout.write('✅ Model artifact successfully exported to Cloud Storage.\n');
    
    process.stdout.write('\n🚀 Training complete. The model is ready to be deployed to Vertex AI via GitHub Actions.\n');
  } catch (error) {
    die(`BigQuery ML pipeline failed: ${error.message}`);
  }
}

main();