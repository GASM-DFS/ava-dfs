#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS GASM Engine: BigQuery Slate Ingestor
 * 
 * Usage:
 *   node scripts/ingestToBigQuery.js --project <project-id> --dataset <dataset-id> --table <table-id> --file <absolute-path|/dev/stdin>
 * 
 * Example:
 *   node scripts/fetchDailySlate.js ... | node scripts/ingestToBigQuery.js --project gasm-481006 --dataset nba_dfs_data --table fact_box_scores --file /dev/stdin
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

  if (!args.project)               die('--project is required');
  if (!args.dataset)               die('--dataset is required');
  if (!args.table)                 die('--table is required');
  if (!args.file)                  die('--file <absolute-path> or /dev/stdin is required');
  if (args.file !== '/dev/stdin' && !path.isAbsolute(args.file)) die('--file must be an absolute path or /dev/stdin (no auto-discovery)');

  const rows = loadJson(args.file);

  if (!Array.isArray(rows) || rows.length === 0) {
    die('Data contract violation: Input must be a non-empty JSON array of rows.');
  }

  const bigquery = new BigQuery({ projectId: args.project });

  try {
    process.stdout.write(`🚀 Firing ${rows.length} rows to BigQuery (${args.project}:${args.dataset}.${args.table})...\n`);
    
    // Perform a streaming insert into the table
    await bigquery.dataset(args.dataset).table(args.table).insert(rows);
    
    process.stdout.write('✅ Successfully uploaded batch to BigQuery.\n');
  } catch (error) {
    // BigQuery streaming inserts throw a specific error object when rows fail validation
    if (error.name === 'PartialFailureError' && error.errors) {
      const firstError = error.errors[0].errors[0];
      die(`BigQuery PartialFailure: ${firstError.message} (Reason: ${firstError.reason})`);
    } else {
      die(`Failed to insert into BigQuery: ${error.message}`);
    }
  }
}

main();