const { runIngestor } = require('../shared/runIngestor');

async function fetchVegasOdds() {
  return {
    odds: [],
    fetchedAt: new Date().toISOString(),
    note: 'Replace stub with vegas odds API integration.'
  };
}

module.exports = async function ingestVegasOdds() {
  return runIngestor({
    source: 'vegas-odds',
    topic: 'injury-updates',
    requiredFields: ['odds'],
    fetcher: fetchVegasOdds
  });
};
