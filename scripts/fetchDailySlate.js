#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS: External API Slate Ingestor
 * 
 * Usage:
 *   node scripts/fetchDailySlate.js --provider <dk|fd> --sport <nba|mlb|nfl> --date <YYYY-MM-DD> [--type <slate-type>] [--cache <dir>] [--list]
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

  if (!args.provider) die('--provider <dk|fd> is required');
  if (!args.sport)    die('--sport <nba|mlb|nfl> is required');
  if (!args.date)     die('--date <YYYY-MM-DD> is required');
  
  validateDate(args.date);

  if (args.provider.toLowerCase() !== 'dk') {
    die('This free integration script currently only supports --provider dk (DraftKings).');
  }

  const SPORT_IDS = { nfl: 1, mlb: 2, nba: 4 };
  const sportId = SPORT_IDS[args.sport.toLowerCase()];
  if (!sportId) {
    die(`Unsupported sport: ${args.sport}. Supported sports are nba, mlb, nfl.`);
  }

  // Define standard browser headers to bypass basic bot-detection/WAFs
  const requestHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
    'Accept': 'application/json'
  };

  try {
    // Step 1: Find the active DraftGroup for the requested date
    const groupsUrl = `https://api.draftkings.com/draftgroups/v1/?sportId=${sportId}`;
    const groupsData = await fetchJsonWithCache(groupsUrl, { headers: requestHeaders }, args.cache, 'Failed to fetch DraftGroups from DraftKings');
    
    let targetGroups = groupsData.draftGroups?.filter(dg => dg.minStartTime.startsWith(args.date));

    // If --list is provided, output a summary of available slates and exit
    if (args.list) {
      const summary = targetGroups?.map(dg => ({
        DraftGroupId: dg.draftGroupId,
        Suffix: dg.suffix || 'Main',
        StartTime: dg.minStartTime,
        GameCount: dg.gamesCount
      })) || [];
      process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
      process.exit(0);
    }

    // If a type is specified (e.g., "Main", "Turbo", "Showdown"), filter by the DraftGroup suffix
    if (args.type) {
      targetGroups = targetGroups?.filter(dg => 
        dg.suffix && dg.suffix.toLowerCase().includes(args.type.toLowerCase())
      );
    } else {
      // By default, exclude Showdown and Captain Mode slates
      targetGroups = targetGroups?.filter(dg => {
        if (!dg.suffix) return true; // Keep if no suffix is provided
        const suffix = dg.suffix.toLowerCase();
        return !suffix.includes('showdown') && !suffix.includes('captain mode');
      });
    }

    const draftGroup = targetGroups?.[0];
    
    if (!draftGroup) {
      const typeMsg = args.type ? ` of type "${args.type}"` : '';
      die(`No DraftKings slate found for sport ${args.sport} on date ${args.date}${typeMsg}.`);
    }

    // Step 2: Fetch the players (draftables) for that DraftGroup
    const playersUrl = `https://api.draftkings.com/draftgroups/v1/draftgroups/${draftGroup.draftGroupId}/draftables`;
    const payload = await fetchJsonWithCache(playersUrl, { headers: requestHeaders }, args.cache, `Failed to fetch players for DraftGroup ${draftGroup.draftGroupId}`);

    if (!payload || !Array.isArray(payload.draftables)) {
      die('Data contract violation: DraftKings API response missing strictly structured "draftables" array.');
    }

    // Map to the canonical Ava-DFS raw row format expected by `playerRegistry` downstream.
    const rawRows = payload.draftables.map(p => ({
      ID: p.playerId,
      Name: p.displayName,
      Position: p.position,
      Salary: p.salary,
      TeamAbbrev: p.teamAbbreviation
    }));

    process.stdout.write(JSON.stringify(rawRows, null, 2) + '\n');
  } catch (error) {
    die(`Network or execution error during slate fetch: ${error.message}`);
  }
}

main();