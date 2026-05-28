#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS: Premium API Slate Ingestor
 * 
 * Usage:
 *   node scripts/fetchDailySlate.js --provider <dk|fd|sportsdataio> --sport <nba|mlb|nfl> --date <YYYY-MM-DD> [--api-key <YOUR_API_KEY>] [--type <slate-type>] [--cache <dir>] [--list]
 * 
 * Output:
 *   Writes a strict JSON array of player slate objects to stdout.
 */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

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

/**
 * Validates the date string conforms to strict YYYY-MM-DD format.
 */
function validateDate(dateStr) {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) {
    die(`Invalid date format: "${dateStr}". Must be strictly YYYY-MM-DD.`);
  }
}

/**
 * Transparently fetches JSON from a URL, utilizing a local file cache if a cache directory is provided.
 */
async function fetchJsonWithCache(url, options, cacheDir, errorContext) {
  let cachePath;
  if (cacheDir) {
    const hash = crypto.createHash('md5').update(url).digest('hex');
    cachePath = path.resolve(process.cwd(), cacheDir, `${hash}.json`);
    try {
      const cachedData = await fs.readFile(cachePath, 'utf8');
      return JSON.parse(cachedData);
    } catch (err) {
      // Cache miss or read error, proceed to network request
    }
  }

  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`${errorContext}: ${res.status}`);
  const data = await res.json();

  if (cacheDir && cachePath) {
    try {
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      process.stderr.write(`⚠️ Warning: Failed to write cache to ${cachePath}: ${err.message}\n`);
    }
  }
  return data;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.provider) die('--provider <dk|fd|sportsdataio> is required');
  if (!args.sport)    die('--sport <nba|mlb|nfl> is required');
  if (!args.date)     die('--date <YYYY-MM-DD> is required');
  
  validateDate(args.date);

  const apiKey = args['api-key'] || process.env.SPORTS_API_KEY;
  if (!apiKey) {
    die('Data contract violation: Premium API key is required. Pass --api-key or set SPORTS_API_KEY.');
  }

  const providerMap = {
    'dk': 'DraftKings',
    'fd': 'FanDuel',
    'sportsdataio': 'DraftKings' // Default to DraftKings if generic provider flag is passed
  };

  const targetOperator = providerMap[args.provider.toLowerCase()];
  if (!targetOperator) {
    die(`Unsupported provider: ${args.provider}. Supported: dk, fd, sportsdataio.`);
  }

  const sportUrlSegment = args.sport.toLowerCase();

  try {
    const url = `https://api.sportsdata.io/v3/${sportUrlSegment}/dfs/json/DfsSlatesByDate/${args.date}?key=${apiKey}`;
    const slatesData = await fetchJsonWithCache(url, { headers: { 'Accept': 'application/json' } }, args.cache, 'Failed to fetch slates from SportsData.io');
    
    if (!Array.isArray(slatesData)) {
      die('Data contract violation: SportsData.io returned an invalid response (not an array).');
    }

    let targetSlates = slatesData.filter(s => s.Operator && s.Operator.toLowerCase() === targetOperator.toLowerCase());

    // If --list is provided, output a summary of available slates and exit
    if (args.list) {
      const summary = targetSlates.map(dg => ({
        SlateID: dg.SlateID,
        Operator: dg.Operator,
        OperatorName: dg.OperatorName,
        GameType: dg.OperatorGameType,
        GameCount: dg.NumberOfGames || (dg.DfsSlateGames ? dg.DfsSlateGames.length : 0)
      }));
      process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
      process.exit(0);
    }

    // Filter by type (e.g., "Main", "Turbo", "Showdown")
    if (args.type) {
      targetSlates = targetSlates.filter(s => 
        s.OperatorName && s.OperatorName.toLowerCase().includes(args.type.toLowerCase())
      );
    } else {
      // By default, exclude Showdown and Captain Mode slates
      targetSlates = targetSlates.filter(s => {
        if (!s.OperatorName) return true;
        const name = s.OperatorName.toLowerCase();
        return !name.includes('showdown') && !name.includes('captain mode') && !name.includes('single game');
      });
    }

    const draftGroup = targetSlates[0];
    
    if (!draftGroup) {
      const typeMsg = args.type ? ` of type "${args.type}"` : '';
      die(`No ${targetOperator} slate found for sport ${args.sport} on date ${args.date}${typeMsg}.`);
    }

    if (!Array.isArray(draftGroup.DfsSlatePlayers)) {
      die(`Data contract violation: SportsData.io slate ${draftGroup.SlateID} is missing the "DfsSlatePlayers" array.`);
    }

    // Map to the canonical Ava-DFS raw row format expected by `playerRegistry` downstream.
    const rawRows = draftGroup.DfsSlatePlayers
      .filter(p => p.RemovedByOperator !== true && p.OperatorPlayerID != null)
      .map(p => ({
        ID: String(p.OperatorPlayerID),
        Name: p.OperatorPlayerName || p.OperatorName || 'Unknown',
        Position: p.OperatorPosition || 'UTIL',
        Salary: p.OperatorSalary,
        TeamAbbrev: p.Team || p.TeamAbbrev || 'UNK'
      }));

    process.stdout.write(JSON.stringify(rawRows, null, 2) + '\n');
  } catch (error) {
    die(`Network or execution error during slate fetch: ${error.message}`);
  }
}

main();