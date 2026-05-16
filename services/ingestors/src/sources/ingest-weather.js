const { runIngestor } = require('../shared/runIngestor');

async function fetchWeather() {
  return {
    stadiums: [],
    fetchedAt: new Date().toISOString(),
    note: 'Replace stub with OpenWeather / stadium micro-climate feed.'
  };
}

module.exports = async function ingestWeather() {
  return runIngestor({
    source: 'weather',
    topic: 'weather-updates',
    requiredFields: ['stadiums'],
    fetcher: fetchWeather
  });
};
