const ingestStatcast = require('./sources/ingest-statcast');
const ingestSportsradar = require('./sources/ingest-sportsradar');
const ingestWeather = require('./sources/ingest-weather');
const ingestVegasOdds = require('./sources/ingest-vegas-odds');
const ingestUmpire = require('./sources/ingest-umpire');
const ingestMinors = require('./sources/ingest-minors');

const sourceMap = {
  'ingest-statcast': ingestStatcast,
  'ingest-sportsradar': ingestSportsradar,
  'ingest-weather': ingestWeather,
  'ingest-vegas-odds': ingestVegasOdds,
  'ingest-umpire': ingestUmpire,
  'ingest-minors': ingestMinors
};

async function run(sourceName) {
  const runner = sourceMap[sourceName];
  if (!runner) {
    throw new Error(`Unknown ingestor: ${sourceName}`);
  }

  return runner();
}

module.exports = { run, sourceMap };
