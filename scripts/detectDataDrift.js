#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS: Feature Store Data Drift Detector
 * 
 * Usage:
 *   node scripts/detectDataDrift.js --reference <path> --current <path> [--threshold <number>] [--slack-webhook <url>]
 * 
 * Output:
 *   Writes a strict JSON report of drift metrics to stdout.
 */

const { readFileSync } = require('fs');
const path = require('path');
const { detectDrift } = require('../services/observability/drift');

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

  if (!args.reference) die('--reference <absolute-path> is required');
  if (!args.current)   die('--current <absolute-path> is required');

  const threshold = args.threshold ? parseFloat(args.threshold) : 0.20;

  const referenceData = loadJson(args.reference);
  const currentData   = loadJson(args.current);

  try {
    const output = detectDrift(referenceData, currentData, threshold);
    
    // If critical drift is detected and a webhook is provided, trigger a Slack alert
    if (output.metadata.criticalDrift && args['slack-webhook']) {
      const topDrifts = output.metrics
        .filter(m => m.DriftDetected)
        .slice(0, 3) // Only show the top 3 biggest drifts to avoid spamming the channel
        .map(m => `- *${m.Feature}*: ${(m.ShiftPercentage * 100).toFixed(1)}% shift (Ref: ${m.ReferenceMean}, Cur: ${m.CurrentMean})`)
        .join('\n');
        
      const payload = {
        text: `🚨 *Ava-DFS Alert: Data Drift Detected!*\nPlayer feature distributions have shifted beyond the ${(threshold * 100).toFixed(1)}% threshold.\n\n*Top Drifts:*\n${topDrifts}`
      };

      await fetch(args['slack-webhook'], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(err => process.stderr.write(`⚠️ Warning: Failed to dispatch Slack alert: ${err.message}\n`));
    }

    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  } catch (error) {
    die(error.message);
  }
}

main();