#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS GASM Engine: Data Completeness & ID Mapping Verifier
 * 
 * Usage:
 *   node scripts/verifyDataCompleteness.js --project <project-id> --dataset <dataset-id> [--location <region>]
 * 
 * Example:
 *   node scripts/verifyDataCompleteness.js --project gasm-481006 --dataset nba_dfs_data --location us-central1
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
  const location = args.location || 'US';

  const bigquery = new BigQuery({ projectId: args.project });

  process.stdout.write(`\n🔍 Initiating Data Completeness Audit for ${args.project}:${args.dataset}...\n`);
  process.stdout.write(`===================================================================\n`);

  // Check 1: Box Score ID to DraftKings Slate Mapping
  const mappingQuery = `
    SELECT 
      COUNT(1) AS TotalBoxScores,
      COUNTIF(ds.ID IS NOT NULL) AS SuccessfullyMapped,
      COUNTIF(ds.ID IS NULL) AS OrphanedRecords
    FROM \`${args.project}.${args.dataset}.fact_box_scores\` fbs
    LEFT JOIN (SELECT DISTINCT ID FROM \`${args.project}.${args.dataset}.daily_slates\`) ds
      ON fbs.ID = ds.ID
    WHERE fbs.GameDate >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
  `;

  // Check 2: Gold Layer Feature Completeness (No Null Target Variables)
  const featureQuery = `
    SELECT 
      COUNT(1) AS TotalFeatures,
      COUNTIF(Target_FantasyPointsDK IS NULL) AS NullTargets,
      COUNTIF(rolling_5g_minutes IS NULL) AS MissingRollingStats
    FROM \`${args.project}.${args.dataset}.gold_player_features\`
  `;

  try {
    // Run ID Mapping Check
    process.stdout.write(`1️⃣  Checking DraftKings ID mapping over the last 7 days...\n`);
    const [mappingRows] = await bigquery.query({ query: mappingQuery, location });
    const mapping = mappingRows[0];
    const matchRate = mapping.TotalBoxScores > 0 
      ? ((mapping.SuccessfullyMapped / mapping.TotalBoxScores) * 100).toFixed(2) 
      : 0;

    process.stdout.write(`    Total Box Scores: ${mapping.TotalBoxScores}\n`);
    process.stdout.write(`    Mapped to Slates: ${mapping.SuccessfullyMapped} (${matchRate}%)\n`);
    process.stdout.write(`    Orphaned (ID Mismatch): ${mapping.OrphanedRecords}\n\n`);

    if (mapping.OrphanedRecords > 0) {
      process.stdout.write(`    🚨 WARNING: ID mismatch detected. External IDs are failing to map to DraftKings IDs.\n\n`);
    }

    // Run Feature Store Check
    process.stdout.write(`2️⃣  Checking Gold Layer Feature Integrity...\n`);
    const [featureRows] = await bigquery.query({ query: featureQuery, location });
    const features = featureRows[0];

    process.stdout.write(`    Total Feature Rows: ${features.TotalFeatures}\n`);
    process.stdout.write(`    Missing Target Variables: ${features.NullTargets}\n`);
    process.stdout.write(`    Missing Rolling Stats: ${features.MissingRollingStats}\n\n`);

    process.stdout.write(`===================================================================\n`);
    process.stdout.write(`✅ Audit Complete.\n`);
  } catch (error) {
    die(`BigQuery Audit Failed: ${error.message}`);
  }
}

main();