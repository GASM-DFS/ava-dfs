#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS: Google Drive CSV Ingestor
 * 
 * Usage:
 *   node scripts/readDriveCsv.js --file-id <drive-file-id> --key-file <absolute-path-to-sa.json>
 */

const { google } = require('googleapis');
const path = require('path');
const readline = require('readline');

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

  if (!args['file-id']) {
    die('--file-id is required');
  }
  if (!args['key-file']) {
    die('--key-file <absolute-path> is required');
  }
  if (!path.isAbsolute(args['key-file'])) {
    die('--key-file must be an absolute path (no relative pathing permitted)');
  }

  try {
    // 1. Authenticate using the Service Account
    const auth = new google.auth.GoogleAuth({
      keyFile: args['key-file'],
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });

    const drive = google.drive({ version: 'v3', auth });

    // 2. Fetch the file as a stream
    const res = await drive.files.get(
      { fileId: args['file-id'], alt: 'media' },
      { responseType: 'stream' }
    );

    // 3. Process the CSV stream
    // Note: This uses a simple comma split. For more robust parsing (e.g., commas inside quotes), 
    // consider adding 'csv-parse' to your package.json and piping the stream into it.
    const rl = readline.createInterface({
      input: res.data,
      crlfDelay: Infinity
    });

    const rows = [];
    let headers = null;

    for await (const line of rl) {
      const cols = line.split(',');
      if (!headers) {
        headers = cols.map(h => h.trim());
      } else {
        const row = {};
        headers.forEach((header, index) => {
          row[header] = cols[index] ? cols[index].trim() : null;
        });
        rows.push(row);
      }
    }

    // 4. Output strictly formatted JSON to stdout for pipeline consumption
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
  } catch (error) {
    // 5. Fail loudly with exact error
    die(`Failed to read from Google Drive: ${error.message}`);
  }
}

main();