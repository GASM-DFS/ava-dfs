const { runIngestor } = require('../shared/runIngestor');

async function fetchMinorLeagueData() {
  return {
    players: [],
    fetchedAt: new Date().toISOString(),
    note: 'Replace stub with MiLB API integration for MLE translation.'
  };
}

module.exports = async function ingestMinors() {
  return runIngestor({
    source: 'minors',
    topic: 'lineup-updates',
    requiredFields: ['players'],
    fetcher: fetchMinorLeagueData
  });
};
