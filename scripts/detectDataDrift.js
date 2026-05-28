#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS: Feature Store Data Drift Detector
 * 
 * Usage:
 *   node scripts/detectDataDrift.js --reference <path> --current <path> [--threshold <number>]
 * 
 * Output:
 *   Writes a strict JSON report of drift metrics to stdout.
 */

const { readFileSync } = require('fs');
const path = require('path');

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

function calculateMean(arr, key) {
  let sum = 0;
  let count = 0;
  for (const obj of arr) {
    if (typeof obj[key] === 'number' && !isNaN(obj[key])) {
      sum += obj[key];
      count++;
    }
  }
  return count > 0 ? sum / count : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.reference) die('--reference <absolute-path> is required');
  if (!args.current)   die('--current <absolute-path> is required');

  const threshold = args.threshold ? parseFloat(args.threshold) : 0.20;

  const referenceData = loadJson(args.reference);
  const currentData   = loadJson(args.current);

  if (!Array.isArray(referenceData) || !Array.isArray(currentData)) {
    die('Data contract violation: Inputs must be JSON arrays.');
  }

  if (referenceData.length === 0 || currentData.length === 0) {
    die('Cannot detect drift on empty datasets.');
  }

  // Identify all numeric keys from the first object in reference data
  const numericKeys = Object.keys(referenceData[0]).filter(
    key => typeof referenceData[0][key] === 'number'
  );

  const driftReport = [];
  let isDrifting = false;

  for (const key of numericKeys) {
    const refMean = calculateMean(referenceData, key);
    const curMean = calculateMean(currentData, key);

    if (refMean === null || curMean === null) continue;

    // Calculate percentage shift (protecting against zero-division)
    let shiftPercent = 0;
    if (refMean !== 0) {
      shiftPercent = Math.abs((curMean - refMean) / refMean);
    } else if (curMean !== 0) {
      shiftPercent = 1.0; // 100% shift if moving from exactly 0
    }

    const drifted = shiftPercent >= threshold;
    if (drifted) isDrifting = true;

    driftReport.push({
      Feature: key,
      ReferenceMean: parseFloat(refMean.toFixed(4)),
      CurrentMean: parseFloat(curMean.toFixed(4)),
      ShiftPercentage: parseFloat(shiftPercent.toFixed(4)),
      DriftDetected: drifted
    });
  }

  const output = {
    metadata: {
      referenceSize: referenceData.length,
      currentSize: currentData.length,
      threshold: threshold,
      criticalDrift: isDrifting
    },
    metrics: driftReport.sort((a, b) => b.ShiftPercentage - a.ShiftPercentage)
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

main();