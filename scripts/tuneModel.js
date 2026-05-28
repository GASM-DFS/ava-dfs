#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS GASM Engine: BigQuery ML Hyperparameter Tuning Orchestrator
 * 
 * Usage:
 *   node scripts/tuneModel.js --project <project-id> --dataset <dataset-id> --trials <num> [--version <version-tag>]
 * 
 * Example:
 *   node scripts/tuneModel.js --project gasm-481006 --dataset nba_dfs_data --trials 20 --version v1.1.0
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
  
  const trials = parseInt(args.trials, 10) || 10;
  const bigquery = new BigQuery({ projectId: args.project });

  // BQML Hyperparameter Tuning utilizes Vertex AI Vizier under the hood.
  const tuneQuery = `
    CREATE OR REPLACE MODEL \`${args.project}.${args.dataset}.nba_xgboost_model\`
    OPTIONS(
      MODEL_TYPE='BOOSTED_TREE_REGRESSOR',
      INPUT_LABEL_COLS=['Target_FantasyPointsDK'],
      DATA_SPLIT_METHOD='AUTO_SPLIT',
      NUM_TRIALS=${trials},
      MAX_PARALLEL_TRIALS=2,
      MAX_ITERATIONS=HPARAM_RANGE(50, 200),
      LEARN_RATE=HPARAM_RANGE(0.01, 0.3),
      MAX_TREE_DEPTH=HPARAM_CANDIDATES([4, 6, 8, 10]),
      SUBSAMPLE=HPARAM_RANGE(0.5, 1.0)
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

  try {
    process.stdout.write(`🧠 Initiating Hyperparameter Tuning (${trials} trials) via BigQuery ML & Vertex AI Vizier...\n`);
    const [tuneJob] = await bigquery.createQueryJob({ query: tuneQuery });
    process.stdout.write(`⏳ Job ${tuneJob.id} started. This will take significantly longer than standard training...\n`);
    await tuneJob.getQueryResults();
    process.stdout.write('✅ Hyperparameter tuning complete. Best model selected and saved in BigQuery.\n');

    if (args.version) {
      const exportQuery = `
        EXPORT MODEL \`${args.project}.${args.dataset}.nba_xgboost_model\`
        OPTIONS(URI='gs://cloud-ai-platform/models/nba-dfs/${args.version}')
      `;
      process.stdout.write(`\n📦 Exporting best tuned model.bst to gs://cloud-ai-platform/models/nba-dfs/${args.version}...\n`);
      const [exportJob] = await bigquery.createQueryJob({ query: exportQuery });
      await exportJob.getQueryResults();
      process.stdout.write('✅ Model artifact successfully exported to Cloud Storage.\n');
    }

    process.stdout.write('\n🚀 Pipeline complete. The tuned model is ready for Vertex AI deployment.\n');
  } catch (error) {
    die(`Hyperparameter tuning pipeline failed: ${error.message}`);
  }
}

main();