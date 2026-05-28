#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS GASM Engine: Internet Sentiment CLI Wrapper
 * 
 * Usage:
 *   node scripts/ingestSentiment.js --project <project-id> --location <region> --player "LeBron James" --date <YYYY-MM-DD>
 * 
 * Output:
 *   Searches the live web and writes a strict JSON object with sentiment metrics to stdout.
 */

const { getPlayerSentiment } = require('../services/ingestors/sentiment');

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

  if (!args.project)  die('--project is required');
  if (!args.location) die('--location is required (e.g., us-central1)');
  if (!args.player)   die('--player is required');
  if (!args.date)     die('--date <YYYY-MM-DD> is required');

  try {
    process.stdout.write(`🌐 Initiating live internet search and sentiment analysis for ${args.player}...\n`);
    
    const output = await getPlayerSentiment({
      project: args.project,
      location: args.location,
      player: args.player,
      date: args.date
    });

    // Output strict JSON for ingestion into BigQuery Silver layer
    process.stdout.write(JSON.stringify([output], null, 2) + '\n');

  } catch (error) {
    // Defensive Programming: If the API is down, fail loudly but don't break the whole pipeline.
    // We output a fallback neutral score so the data contract remains intact for BigQuery.
    process.stderr.write(`⚠️ Warning: Sentiment analysis for ${args.player} triggered fallback: ${error.message}\n`);
    const fallback = [{ Name: args.player, GameDate: args.date, SentimentScore: 0.0, InjuryRisk: 0.0, Narrative: "API Error" }];
    process.stdout.write(JSON.stringify(fallback, null, 2) + '\n');
  }
}

main();