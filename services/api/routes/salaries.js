'use strict';

const { Readable } = require('stream');
const { Router }   = require('express');
const { BigQuery } = require('@google-cloud/bigquery');
const { logger }   = require('../../observability/logger');

const router     = Router();
const PROJECT_ID = process.env.GCP_PROJECT_ID || 'gasm-481006';
const bq         = new BigQuery({ projectId: PROJECT_ID });

// DK Classic CSV headers vary slightly by sport.
// We normalise header names to snake_case keys before mapping to BQ.
const HEADER_ALIASES = {
  'name + id':          'name_id',
  'name+id':            'name_id',
  'name_+_id':          'name_id',
  'roster position':    'roster_position',
  'game info':          'game_info',
  'teamabbrev':         'team_abbrev',
  'avgpointsperGame':   'avg_pts',
  'avgpointspergame':   'avg_pts',
  'avgpts':             'avg_pts',
  'position':           'position',
  'name':               'name',
  'id':                 'id',
  'salary':             'salary',
  'status':             'status',
};

// Sport-specific BigQuery target and row-builder
const SPORT_CONFIG = {
  mlb: {
    dataset: 'mlb_dfs_projections',
    table:   'v1_player_list',
    schema: [
      { name: 'Name',     type: 'STRING'  },
      { name: 'ID',       type: 'INTEGER' },
      { name: 'Position', type: 'STRING'  },
      { name: 'Salary',   type: 'INTEGER' },
      { name: 'AvgPts',   type: 'FLOAT'   },
      { name: 'Team',     type: 'STRING'  },
      { name: 'Status',   type: 'STRING'  },
    ],
    buildRow(p) {
      return {
        Name:     p.name        || null,
        ID:       p.id          ? parseInt(p.id, 10) : null,
        Position: p.position    || null,
        Salary:   p.salary      ? parseInt(p.salary, 10) : null,
        AvgPts:   p.avg_pts     ? parseFloat(p.avg_pts) : null,
        Team:     p.team_abbrev || null,
        Status:   p.status      || null,
      };
    },
  },
  nba: {
    dataset: 'nba_dfs_projections',
    table:   'v1_player_list',
    schema: [
      { name: 'Position',         type: 'STRING'  },
      { name: 'Name_+_ID',        type: 'STRING'  },
      { name: 'Name',             type: 'STRING'  },
      { name: 'ID',               type: 'INTEGER' },
      { name: 'Roster_Position',  type: 'STRING'  },
      { name: 'Salary',           type: 'INTEGER' },
      { name: 'Game_Info',        type: 'STRING'  },
      { name: 'TeamAbbrev',       type: 'STRING'  },
      { name: 'AvgPointsPerGame', type: 'FLOAT'   },
      { name: 'Status',           type: 'STRING'  },
    ],
    buildRow(p) {
      return {
        Position:         p.position        || null,
        'Name_+_ID':      p.name_id         || null,
        Name:             p.name            || null,
        ID:               p.id              ? parseInt(p.id, 10) : null,
        Roster_Position:  p.roster_position || null,
        Salary:           p.salary          ? parseInt(p.salary, 10) : null,
        Game_Info:        p.game_info       || null,
        TeamAbbrev:       p.team_abbrev     || null,
        AvgPointsPerGame: p.avg_pts         ? parseFloat(p.avg_pts) : null,
        Status:           p.status          || null,
      };
    },
  },
};

function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  if (lines.length < 2) return [];

  // Parse a single CSV line, respecting quoted fields
  function parseLine(line) {
    const fields = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (c === ',' && !inQ) { fields.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    fields.push(cur.trim());
    return fields;
  }

  const rawHeaders = parseLine(lines[0]);
  const headers    = rawHeaders.map(h => HEADER_ALIASES[h.toLowerCase().trim()] || h.toLowerCase().replace(/\s+/g, '_'));

  return lines.slice(1)
    .map(line => {
      const vals = parseLine(line);
      const obj  = {};
      headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
      return obj;
    })
    .filter(p => p.name && p.id); // drop blank/instruction rows
}

async function uploadSalaries(req, res, sport) {
  const config = SPORT_CONFIG[sport];
  if (!config) {
    return res.status(400).json({ error: `Unsupported sport: ${sport}. Supported: ${Object.keys(SPORT_CONFIG).join(', ')}` });
  }

  const csvText = req.body;
  if (!csvText || typeof csvText !== 'string' || csvText.trim().length < 10) {
    return res.status(400).json({ error: 'Request body must be raw CSV text' });
  }

  let players;
  try {
    players = parseCsv(csvText);
  } catch (err) {
    return res.status(400).json({ error: `CSV parse error: ${err.message}` });
  }

  if (!players.length) {
    return res.status(400).json({ error: 'No valid player rows found in CSV' });
  }

  try {
    const rows  = players.map(p => config.buildRow(p));
    const table = bq.dataset(config.dataset, { location: 'us-central1' }).table(config.table);

    // Use a load job with WRITE_TRUNCATE — atomically replaces all rows without
    // hitting BigQuery's streaming buffer lock that blocks DELETE statements.
    const ndjson = rows.map(r => JSON.stringify(r)).join('\n') + '\n';
    await new Promise((resolve, reject) => {
      const writeStream = table.createWriteStream({
        sourceFormat:     'NEWLINE_DELIMITED_JSON',
        writeDisposition: 'WRITE_TRUNCATE',
        schema:           { fields: config.schema },
      });
      Readable.from([ndjson]).pipe(writeStream)
        .on('job',   job  => job.promise().then(resolve).catch(reject))
        .on('error', reject);
    });

    logger.info({ sport, count: rows.length }, 'Salary upload complete');
    res.json({ sport, count: rows.length, uploadedAt: new Date().toISOString() });
  } catch (err) {
    logger.error({ error: err.message, sport }, 'Salary upload failed');
    res.status(500).json({ error: err.message });
  }
}

router.post('/salaries/upload/:sport', async (req, res) => {
  await uploadSalaries(req, res, req.params.sport.toLowerCase());
});

// GET current salary metadata (count + last-updated proxy via row count)
router.get('/salaries/status/:sport', async (req, res) => {
  const sport  = req.params.sport.toLowerCase();
  const config = SPORT_CONFIG[sport];
  if (!config) return res.status(400).json({ error: `Unsupported sport: ${sport}` });

  try {
    const [rows] = await bq.query({
      query:    `SELECT COUNT(*) AS cnt, MAX(Salary) AS max_sal FROM \`${PROJECT_ID}.${config.dataset}.${config.table}\``,
      location: 'us-central1',
    });
    res.json({ sport, playerCount: Number(rows[0].cnt), maxSalary: Number(rows[0].max_sal) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { salariesRouter: router };
