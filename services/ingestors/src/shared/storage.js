const fs = require('node:fs/promises');
const path = require('node:path');

const localRawRoot = process.env.LOCAL_RAW_ROOT || path.join(process.cwd(), 'services', 'data', 'raw');

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
  const safeSource = sanitizeSourceName(source);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sourceDir = path.join(localRawRoot, safeSource);
  await fs.mkdir(sourceDir, { recursive: true });

  const filename = `${timestamp}.json`;
  const fullPath = path.join(sourceDir, filename);
  await fs.writeFile(fullPath, JSON.stringify(payload, null, 2), 'utf8');

  return fullPath;
}

module.exports = { persistRawPayload, sanitizeSourceName };
