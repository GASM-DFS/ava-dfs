#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS: BigQuery View Deployment Automation
 * 
 * Usage:
 *   node cli/deployGoldViews.js --project <gcp-project-id> --file <absolute-path-to-sql-file>
 * 
 * Description:
 *   Reads a .sql file containing BigQuery DDL (e.g., CREATE OR REPLACE VIEW)
 *   and synchronously applies it to the target GCP environment.
 */

const { BigQuery } = require('@google-cloud/bigquery');
const fs = require('fs');
const path = require('path');

function die(msg) {
  process.stderr.write(`[Fatal Error]: ${msg}\n`);
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

  // 1. Strict Contract Validation
  if (!args.project) {
    die('Missing required argument: --project (e.g., gasm-481006)');
  }
  if (!args.file) {
    die('Missing required argument: --file (Absolute path to the .sql file)');
  }
  if (!path.isAbsolute(args.file)) {
    die(`Path violation: --file must be an absolute path. Received: ${args.file}`);
  }
  if (!fs.existsSync(args.file)) {
    die(`File not found: ${args.file}`);
  }

  // 2. Load the SQL definition
  let sqlQuery = '';
  try {
    sqlQuery = fs.readFileSync(args.file, 'utf8');
  } catch (error) {
    die(`Failed to read SQL file: ${error.message}`);
  }

  // 3. Authenticate and Execute against BigQuery
  const bq = new BigQuery({ projectId: args.project });

  process.stdout.write(`🚀 Deploying SQL definition from ${path.basename(args.file)} to project ${args.project}...\n`);

  try {
    // Execute the query. Since it's DDL (CREATE OR REPLACE VIEW), it won't return rows.
    const [job] = await bq.createQueryJob({ query: sqlQuery });
    process.stdout.write(`⏳ Job ${job.id} started. Waiting for completion...\n`);
    
    await job.getQueryResults();
    process.stdout.write(`✅ Successfully applied SQL definition to BigQuery.\n`);
  } catch (error) {
    die(`BigQuery Execution Failed: ${error.message}\n${error.stack}`);
  }
}

main();