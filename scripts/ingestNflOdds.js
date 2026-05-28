#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS: NFL Vegas Odds Ingestor
 * 
 * Usage:
 *   node scripts/ingestNflOdds.js --api-key <YOUR_ODDS_API_KEY>
 * 
 * Output:
 *   Writes a strict JSON array of NFL game odds and implied totals to stdout.
 */

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
  const apiKey = args['api-key'] || process.env.ODDS_API_KEY;

  if (!apiKey) {
    die('--api-key argument or ODDS_API_KEY environment variable is required');
  }

  // Request upcoming NFL games, DK odds, American format (e.g., -110)
  const url = `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&bookmakers=draftkings&oddsFormat=american`;

  try {
    process.stderr.write(`🏈 Fetching live NFL odds from The Odds API...\n`);
    
    const res = await fetch(url);
    if (!res.ok) {
      const errText = await res.text();
      die(`The Odds API failed with status ${res.status}: ${errText}`);
    }
    
    const data = await res.json();
    
    if (!Array.isArray(data)) {
      die('Data contract violation: The Odds API did not return an array of games.');
    }

    // Map the external API response to our canonical Ava-DFS schema
    const oddsRecords = data.map(game => {
      const bookmaker = game.bookmakers?.[0]; // We specifically requested only 'draftkings'
      
      let homeML = null, awayML = null, homeSpread = null, overUnder = null;

      if (bookmaker && Array.isArray(bookmaker.markets)) {
        const h2h = bookmaker.markets.find(m => m.key === 'h2h');
        if (h2h) {
          homeML = h2h.outcomes.find(o => o.name === game.home_team)?.price ?? null;
          awayML = h2h.outcomes.find(o => o.name === game.away_team)?.price ?? null;
        }

        const spreads = bookmaker.markets.find(m => m.key === 'spreads');
        if (spreads) {
          homeSpread = spreads.outcomes.find(o => o.name === game.home_team)?.point ?? null;
        }

        const totals = bookmaker.markets.find(m => m.key === 'totals');
        if (totals) {
          overUnder = totals.outcomes.find(o => o.name === 'Over')?.point ?? null;
        }
      }

      // Calculate Implied Team Totals dynamically
      let impliedHome = null;
      let impliedAway = null;
      if (homeSpread !== null && overUnder !== null) {
        // If HomeSpread is negative, home team is favored to score MORE points
        impliedHome = (overUnder / 2) - (homeSpread / 2);
        impliedAway = overUnder - impliedHome;
      }

      return {
        GameId: game.id,
        CommenceTime: game.commence_time,
        HomeTeam: game.home_team,
        AwayTeam: game.away_team,
        HomeMoneyline: homeML,
        AwayMoneyline: awayML,
        HomeSpread: homeSpread,
        OverUnder: overUnder,
        ImpliedHomeTotal: impliedHome ? parseFloat(impliedHome.toFixed(2)) : null,
        ImpliedAwayTotal: impliedAway ? parseFloat(impliedAway.toFixed(2)) : null
      };
    });

    // Output strictly formatted JSON for downstream BigQuery piping
    process.stdout.write(JSON.stringify(oddsRecords, null, 2) + '\n');

  } catch (error) {
    die(`Network or execution error during odds fetch: ${error.message}`);
  }
}

main();