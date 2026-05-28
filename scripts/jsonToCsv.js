#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS: Universal JSON to CSV Converter
 * 
 * Usage:
 *   node scripts/jsonToCsv.js [--file <absolute-path|/dev/stdin>]
 * 
 * Example:
 *   node scripts/fetchDailySlate.js ... | node scripts/jsonToCsv.js > slate.csv
 */

const { readFileSync } = require('fs');
const path = require('path');

function loadJson(filePath) {
  try {
    if (filePath === '/dev/stdin') {
      return JSON.parse(readFileSync(0, 'utf8'));
    }
    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch (err) {
    process.stderr.write(`Error reading JSON: ${err.message}\n`);
    process.exit(1);
  }
}

const args = process.argv.slice(2);
const fileArgIdx = args.indexOf('--file');
const file = fileArgIdx !== -1 ? args[fileArgIdx + 1] : '/dev/stdin';

const data = loadJson(file);

if (!Array.isArray(data) || data.length === 0) {
  process.stderr.write('Error: Input must be a non-empty JSON array.\n');
  process.exit(1);
}

// Extract headers dynamically from the first object
const headers = Object.keys(data[0]);
process.stdout.write(headers.join(',') + '\n');

data.forEach(row => {
  const line = headers.map(h => {
    let val = row[h];
    if (val === null || val === undefined) val = '';
    val = String(val).replace(/"/g, '""'); // Escape double quotes
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      val = `"${val}"`; // Wrap in quotes if it contains a comma or newline
    }
    return val;
  });
  process.stdout.write(line.join(',') + '\n');
});