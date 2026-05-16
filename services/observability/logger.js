'use strict';

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL] ?? LOG_LEVELS.info;

function log(level, data, msg) {
  if (LOG_LEVELS[level] < currentLevel) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(data && typeof data === 'object' ? data : {}),
  };
  const out = level === 'error' ? process.stderr : process.stdout;
  out.write(JSON.stringify(entry) + '\n');
}

const logger = {
  debug: (data, msg) => log('debug', data, msg),
  info:  (data, msg) => log('info',  data, msg),
  warn:  (data, msg) => log('warn',  data, msg),
  error: (data, msg) => log('error', data, msg),
};

module.exports = { logger };
