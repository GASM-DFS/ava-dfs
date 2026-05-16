const { runIngestor } = require('../shared/runIngestor');

async function fetchUmpireData() {
  return {
    umpires: [],
    fetchedAt: new Date().toISOString(),
    note: 'Replace stub with Baseball Savant umpire zone extraction.'
  };
}

module.exports = async function ingestUmpire() {
  return runIngestor({
    source: 'umpire',
    topic: 'injury-updates',
    requiredFields: ['umpires'],
    fetcher: fetchUmpireData
  });
};
