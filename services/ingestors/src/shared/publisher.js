const crypto = require('node:crypto');

async function publishEvent(topic, payload) {
  const eventId = crypto.randomUUID();
  console.log(`[pubsub:${topic}]`, JSON.stringify({ eventId, ...payload }));
  return eventId;
}

module.exports = { publishEvent };
