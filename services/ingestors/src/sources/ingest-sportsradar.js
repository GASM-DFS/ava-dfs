const { runIngestor } = require('../shared/runIngestor');

async function fetchSportsradar() {
  return {
    lineups: [],
    injuries: [],
    fetchedAt: new Date().toISOString(),
    note: 'Replace stub with Sportsradar API integration.'
  };
}

module.exports = async function ingestSportsradar() {
  return runIngestor({
    source: 'sportsradar',
    topic: 'lineup-updates',
    requiredFields: ['lineups'],
    fetcher: fetchSportsradar
  });
};
