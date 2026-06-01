#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS: Google Sheets Exporter
 * 
 * Usage:
 *   node scripts/exportToSheets.js --spreadsheet-id <id> --range <Sheet1!A1> \
 *                                  --key-file <absolute-path-to-sa.json> --file <absolute-path|/dev/stdin>
 *                                  [--append]
 * 
 * Example:
 *   ... | node cli/index.js portfolio ... | node scripts/exportToSheets.js --spreadsheet-id 1xyz... --range Output!A1 --key-file /etc/secrets/sa.json --file /dev/stdin
 */

const { readFileSync } = require('fs');
const path = require('path');
const { google } = require('googleapis');

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

  if (!args['spreadsheet-id'])     die('--spreadsheet-id is required');
  if (!args['range'])              die('--range is required (e.g., "Lineups!A1")');
  if (!args['file'])               die('--file <absolute-path> or /dev/stdin is required');
  if (args['key-file'] && !path.isAbsolute(args['key-file'])) die('--key-file must be an absolute path');

  const payload = loadJson(args['file']);
  
  // Extract lineups depending on if input is a single lineup or a portfolio
  const lineups = payload.lineups ? payload.lineups : (payload.players ? [payload] : null);
  if (!lineups || !Array.isArray(lineups) || lineups.length === 0) {
    die('Data contract violation: Input does not contain valid lineups array.');
  }

  // Dynamically extract the roster slots from the first lineup
  const rosterSlots = lineups[0].players.map(p => p.assignedSlot || p.slot);
  
  // Build the 2D Array for Google Sheets
  const values = [];

  // Header Row
  if (!args.append) {
    values.push(['Lineup ID', ...rosterSlots, 'Total Salary', 'Total Proj FPTS']);
  }

  // Data Rows
  lineups.forEach((lineup, index) => {
    const row = [index + 1];
    
    // Extract player names in exact roster slot order
    lineup.players.forEach(p => {
      row.push(`${p.name} (${p.id})`);
    });

    row.push(lineup.totalSalary || lineup.salary);
    row.push((lineup.totalProjected || lineup.projected).toFixed(2));
    
    values.push(row);
  });

  try {
    process.stdout.write(`🚀 Authenticating with Google Sheets...\n`);
    
    const authOptions = { scopes: ['https://www.googleapis.com/auth/spreadsheets'] };
    if (args['key-file']) {
      authOptions.keyFile = args['key-file'];
    }
    
    const auth = new google.auth.GoogleAuth(authOptions);

    const sheets = google.sheets({ version: 'v4', auth });

    if (args.append) {
      process.stdout.write(`📝 Appending ${lineups.length} lineups to Spreadsheet ${args['spreadsheet-id']} at range ${args['range']}...\n`);
      await sheets.spreadsheets.values.append({
        spreadsheetId: args['spreadsheet-id'],
        range: args['range'],
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values },
      });
    } else {
      // Extract the sheet name from the range (e.g., "Sheet1!A1" -> "Sheet1")
      // to clear the entire sheet before writing new data so old rows don't linger.
      const sheetName = args['range'].split('!')[0];
      process.stdout.write(`🧹 Clearing existing data on sheet "${sheetName}"...\n`);
      await sheets.spreadsheets.values.clear({
        spreadsheetId: args['spreadsheet-id'],
        range: sheetName,
      });

      process.stdout.write(`📝 Writing ${lineups.length} lineups to Spreadsheet ${args['spreadsheet-id']} at range ${args['range']}...\n`);
      await sheets.spreadsheets.values.update({
        spreadsheetId: args['spreadsheet-id'],
        range: args['range'],
        valueInputOption: 'USER_ENTERED',
        requestBody: { values },
      });
    }

    process.stdout.write('✅ Successfully exported lineups to Google Sheets.\n');
  } catch (error) {
    die(`Google Sheets export failed: ${error.message}`);
  }
}

main();