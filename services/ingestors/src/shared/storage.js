const fs = require('node:fs/promises');
const path = require('node:path');

const localRawRoot = process.env.LOCAL_RAW_ROOT || path.join(process.cwd(), 'services', 'data', 'raw');

async function persistRawPayload(source, payload) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sourceDir = path.join(localRawRoot, source);
  await fs.mkdir(sourceDir, { recursive: true });

  const filename = `${timestamp}.json`;
  const fullPath = path.join(sourceDir, filename);
  await fs.writeFile(fullPath, JSON.stringify(payload, null, 2), 'utf8');

  return fullPath;
}

module.exports = { persistRawPayload };
