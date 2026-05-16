const { validatePayload } = require('./schema');
const { persistRawPayload } = require('./storage');
const { publishEvent } = require('./publisher');

async function runIngestor({ source, topic, requiredFields, fetcher }) {
  const payload = await fetcher();
  validatePayload(payload, requiredFields);

  const objectPath = await persistRawPayload(source, payload);
  const eventId = await publishEvent(topic, {
    source,
    objectPath,
    ingestedAt: new Date().toISOString()
  });

  return { source, objectPath, eventId };
}

module.exports = { runIngestor };
