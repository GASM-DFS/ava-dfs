#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS: MLB Open-Meteo Weather Ingestor
 * 
 * Usage:
 *   node scripts/ingestMlbWeather.js --date <YYYY-MM-DD>
 * 
 * Output:
 *   Writes a strict JSON array of stadium weather conditions to stdout.
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

function validateDate(dateStr) {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) {
    die(`Invalid date format: "${dateStr}". Must be strictly YYYY-MM-DD.`);
  }
}

// Canonical list of MLB Stadiums, their geographic coordinates, and dome status
const MLB_STADIUMS = [
  { TeamAbbrev: "ARI", Name: "Chase Field", lat: 33.4455, lon: -112.0667, IsDome: true },
  { TeamAbbrev: "ATL", Name: "Truist Park", lat: 33.8907, lon: -84.4677, IsDome: false },
  { TeamAbbrev: "BAL", Name: "Oriole Park at Camden Yards", lat: 39.2840, lon: -76.6200, IsDome: false },
  { TeamAbbrev: "BOS", Name: "Fenway Park", lat: 42.3467, lon: -71.0972, IsDome: false },
  { TeamAbbrev: "CHC", Name: "Wrigley Field", lat: 41.9484, lon: -87.6553, IsDome: false },
  { TeamAbbrev: "CWS", Name: "Guaranteed Rate Field", lat: 41.8300, lon: -87.6338, IsDome: false },
  { TeamAbbrev: "CIN", Name: "Great American Ball Park", lat: 39.0979, lon: -84.5072, IsDome: false },
  { TeamAbbrev: "CLE", Name: "Progressive Field", lat: 41.4962, lon: -81.6852, IsDome: false },
  { TeamAbbrev: "COL", Name: "Coors Field", lat: 39.7559, lon: -104.9942, IsDome: false },
  { TeamAbbrev: "DET", Name: "Comerica Park", lat: 42.3390, lon: -83.0485, IsDome: false },
  { TeamAbbrev: "HOU", Name: "Minute Maid Park", lat: 29.7573, lon: -95.3555, IsDome: true },
  { TeamAbbrev: "KC",  Name: "Kauffman Stadium", lat: 39.0517, lon: -94.4803, IsDome: false },
  { TeamAbbrev: "LAA", Name: "Angel Stadium", lat: 33.8003, lon: -117.8827, IsDome: false },
  { TeamAbbrev: "LAD", Name: "Dodger Stadium", lat: 34.0738, lon: -118.2400, IsDome: false },
  { TeamAbbrev: "MIA", Name: "loanDepot park", lat: 25.7781, lon: -80.2195, IsDome: true },
  { TeamAbbrev: "MIL", Name: "American Family Field", lat: 43.0280, lon: -87.9712, IsDome: true },
  { TeamAbbrev: "MIN", Name: "Target Field", lat: 44.9817, lon: -93.2778, IsDome: false },
  { TeamAbbrev: "NYM", Name: "Citi Field", lat: 40.7675, lon: -73.8458, IsDome: false },
  { TeamAbbrev: "NYY", Name: "Yankee Stadium", lat: 40.8296, lon: -73.9262, IsDome: false },
  { TeamAbbrev: "OAK", Name: "Oakland Coliseum", lat: 37.7516, lon: -122.2005, IsDome: false },
  { TeamAbbrev: "PHI", Name: "Citizens Bank Park", lat: 39.9061, lon: -75.1665, IsDome: false },
  { TeamAbbrev: "PIT", Name: "PNC Park", lat: 40.4469, lon: -80.0057, IsDome: false },
  { TeamAbbrev: "SD",  Name: "Petco Park", lat: 32.7076, lon: -117.1570, IsDome: false },
  { TeamAbbrev: "SF",  Name: "Oracle Park", lat: 37.7786, lon: -122.3893, IsDome: false },
  { TeamAbbrev: "SEA", Name: "T-Mobile Park", lat: 47.5914, lon: -122.3325, IsDome: true },
  { TeamAbbrev: "STL", Name: "Busch Stadium", lat: 38.6226, lon: -90.1928, IsDome: false },
  { TeamAbbrev: "TB",  Name: "Tropicana Field", lat: 27.7682, lon: -82.6534, IsDome: true },
  { TeamAbbrev: "TEX", Name: "Globe Life Field", lat: 32.7512, lon: -97.0832, IsDome: true },
  { TeamAbbrev: "TOR", Name: "Rogers Centre", lat: 43.6414, lon: -79.3893, IsDome: true },
  { TeamAbbrev: "WSH", Name: "Nationals Park", lat: 38.8730, lon: -77.0074, IsDome: false }
];

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.date) die('--date <YYYY-MM-DD> is required');
  validateDate(args.date);

  // Construct batched Open-Meteo API query
  const lats = MLB_STADIUMS.map(s => s.lat).join(',');
  const lons = MLB_STADIUMS.map(s => s.lon).join(',');
  const metrics = 'temperature_2m_max,precipitation_sum,wind_speed_10m_max,wind_direction_10m_dominant';
  
  // timezone=America%2FNew_York normalizes the "GameDate" to EST to align with standard DFS slates
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&daily=${metrics}&timezone=America%2FNew_York&start_date=${args.date}&end_date=${args.date}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      die(`Open-Meteo API failed with status ${res.status}: ${res.statusText}`);
    }
    
    const data = await res.json();
    if (!Array.isArray(data) || data.length !== MLB_STADIUMS.length) {
      die('Data contract violation: Open-Meteo did not return the expected batched array size.');
    }

    // Map the external API response to our canonical Ava-DFS schema
    const weatherRecords = MLB_STADIUMS.map((stadium, index) => {
      const forecast = data[index].daily || {};
      return {
        Stadium: stadium.Name,
        TeamAbbrev: stadium.TeamAbbrev,
        GameDate: args.date,
        IsDome: stadium.IsDome,
        MaxTemp: forecast.temperature_2m_max?.[0] ?? null,
        PrecipitationSum: forecast.precipitation_sum?.[0] ?? null,
        MaxWindSpeed: forecast.wind_speed_10m_max?.[0] ?? null,
        WindDirection: forecast.wind_direction_10m_dominant?.[0] ?? null
      };
    });

    // Output strictly formatted JSON for downstream piping
    process.stdout.write(JSON.stringify(weatherRecords, null, 2) + '\n');
  } catch (error) {
    die(`Network or execution error during weather fetch: ${error.message}`);
  }
}

main();