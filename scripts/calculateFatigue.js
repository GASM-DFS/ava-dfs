#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS: Circadian Fatigue Index (CFI) Generator
 * 
 * Usage:
 *   node scripts/calculateFatigue.js --date <YYYY-MM-DD> --file <absolute-path|/dev/stdin>
 * 
 * Output:
 *   Writes a strict JSON array of { Team, GameDate, CircadianFatigueIndex } to stdout.
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

function validateDate(dateStr) {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) {
    die(`Invalid date format: "${dateStr}". Must be strictly YYYY-MM-DD.`);
  }
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

/**
 * Calculates the great-circle distance between two points on the Earth.
 */
function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = x => (x * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
            
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.date) die('--date <YYYY-MM-DD> is required');
  if (!args.file) die('--file <absolute-path> or /dev/stdin is required');
  if (args.file !== '/dev/stdin' && !path.isAbsolute(args.file)) die('--file must be an absolute path or /dev/stdin');

  validateDate(args.date);
  const targetDateObj = new Date(args.date);

  const schedule = loadJson(args.file);
  if (!Array.isArray(schedule)) {
    die('Data contract violation: Input must be a JSON array of scheduled games.');
  }

  // Group games by Team and sort chronologically
  const teamSchedules = {};
  for (const game of schedule) {
    if (game.Team == null || !game.GameDate || game.Lat == null || game.Lon == null || game.TZOffset == null) {
      die(`Data contract violation: Missing required schedule fields (Team, GameDate, Lat, Lon, TZOffset) in row: ${JSON.stringify(game)}`);
    }
    if (!teamSchedules[game.Team]) teamSchedules[game.Team] = [];
    teamSchedules[game.Team].push(game);
  }

  const results = [];

  // Calculate Circadian Fatigue Index (CFI) for teams playing on the target date
  for (const [team, games] of Object.entries(teamSchedules)) {
    // Sort chronologically
    games.sort((a, b) => new Date(a.GameDate) - new Date(b.GameDate));
    
    const targetGameIdx = games.findIndex(g => g.GameDate === args.date);
    
    // Skip if team isn't playing on the target date
    if (targetGameIdx === -1) continue;

    let cfi = 0.0;
    const targetGame = games[targetGameIdx];
    
    // If they have a previous game, evaluate rest, distance, and timezone shifts
    if (targetGameIdx > 0) {
      const prevGame = games[targetGameIdx - 1];
      const prevDateObj = new Date(prevGame.GameDate);
      
      // 1. Rest Penalty: Measure days between games (1 = Back-to-Back)
      const daysRest = (targetDateObj - prevDateObj) / (1000 * 60 * 60 * 24);
      if (daysRest === 1) cfi += 40.0; // Massive penalty for back-to-backs
      else if (daysRest === 2) cfi += 10.0; // 1 day of rest (standard)
      
      // 2. Travel Penalty: Flight distance
      const milesTraveled = haversineMiles(prevGame.Lat, prevGame.Lon, targetGame.Lat, targetGame.Lon);
      // Normalize: Add 1 point of fatigue per 100 miles traveled
      cfi += (milesTraveled / 100);

      // 3. Timezone Shift Penalty
      const tzShift = targetGame.TZOffset - prevGame.TZOffset;
      if (tzShift > 0) {
        // Traveling East (Losing time/sleep is much harder on circadian rhythm)
        cfi += (tzShift * 5.0);
      } else if (tzShift < 0) {
        // Traveling West (Gaining time)
        cfi += (Math.abs(tzShift) * 2.0);
      }
    }

    // Cap CFI at a maximum of 100 (Extremely fatigued)
    const normalizedCfi = Math.min(Math.max(cfi, 0.0), 100.0);

    results.push({
      Team: team,
      GameDate: args.date,
      CircadianFatigueIndex: parseFloat(normalizedCfi.toFixed(2))
    });
  }

  // Output strictly formatted JSON to stdout for pipeline consumption
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
}

main();