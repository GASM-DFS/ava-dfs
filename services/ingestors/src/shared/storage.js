const { Storage } = require('@google-cloud/storage');

const bucketName = process.env.RAW_DATA_BUCKET;
const storage = new Storage();

function sanitizeSourceName(source) {
  const cleaned = String(source || '')
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-');

  let start = 0;
  let end = cleaned.length;

  while (start < end && cleaned[start] === '-') {
    start += 1;
  }

  while (end > start && cleaned[end - 1] === '-') {
    end -= 1;
  }

  const trimmed = cleaned.slice(start, end);
  if (!trimmed) {
    throw new Error('source must include alphanumeric characters');
  }

  return trimmed;
}

async function persistRawPayload(source, payload) {
  if (!bucketName) {
    throw new Error('RAW_DATA_BUCKET environment variable is required');
  }

  const safeSource = sanitizeSourceName(source);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const objectPath = `${safeSource}/${timestamp}.json`;
  const file = storage.bucket(bucketName).file(objectPath);

  await file.save(JSON.stringify(payload, null, 2), {
    contentType: 'application/json',
    resumable: false
  });

  return `gs://${bucketName}/${objectPath}`;
}

module.exports = { persistRawPayload, sanitizeSourceName };
