const { runIngestor } = require('../shared/runIngestor');

async function fetchStatcast() {
  return {
    games: [],
    fetchedAt: new Date().toISOString(),
    note: 'Replace stub with MLB Stats API / Statcast integration.'
  };
}

module.exports = async function ingestStatcast() {
  return runIngestor({
    source: 'statcast',
    topic: 'lineup-updates',
    requiredFields: ['games'],
    fetcher: fetchStatcast
  });
};
