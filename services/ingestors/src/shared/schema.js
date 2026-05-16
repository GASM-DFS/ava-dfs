function validatePayload(payload, requiredFields = []) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('payload must be an object');
  }

  for (const field of requiredFields) {
    if (!(field in payload)) {
      throw new Error(`missing required field: ${field}`);
    }
  }

  return true;
}

module.exports = { validatePayload };
