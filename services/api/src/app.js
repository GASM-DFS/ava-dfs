const express = require('express');
const { persistRawPayload } = require('../../ingestors/src/shared/storage');
const { publishEvent } = require('../../ingestors/src/shared/publisher');
const { scorePlayers, buildProjectionResponse } = require('../../models/src/projections');
const { generateLineups } = require('../../optimizer/src');

const app = express();
app.use(express.json());

app.get('/', (_req, res) => {
  res.send('Ava-DFS platform is online.');
});

app.post('/ingest', async (req, res, next) => {
  try {
    const source = req.body?.source || 'manual';
    const payload = req.body?.payload ?? req.body;

    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'payload must be a JSON object' });
    }

    const objectPath = await persistRawPayload(source, payload);
    const eventId = await publishEvent('ingest-events', {
      source,
      objectPath,
      receivedAt: new Date().toISOString()
    });

    return res.status(200).json({ status: 'success', objectPath, eventId });
  } catch (error) {
    return next(error);
  }
});

app.get('/slate/:date', async (req, res, next) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    const players = req.body?.players || [];
    const projections = buildProjectionResponse(scorePlayers(players), date);
    return res.status(200).json(projections);
  } catch (error) {
    return next(error);
  }
});

app.get('/player/:id/projections', async (req, res, next) => {
  try {
    const playerId = req.params.id;
    const projections = buildProjectionResponse(scorePlayers([]), new Date().toISOString().slice(0, 10));
    const player = projections.players.find((entry) => String(entry.playerId) === String(playerId));

    if (!player) {
      return res.status(404).json({ error: `projection not found for player ${playerId}` });
    }

    return res.status(200).json(player);
  } catch (error) {
    return next(error);
  }
});

app.post('/optimize', async (req, res, next) => {
  try {
    const { players = [], constraints = {} } = req.body || {};
    if (!Array.isArray(players) || players.length === 0) {
      return res.status(400).json({ error: 'players must be a non-empty array' });
    }

    const lineups = generateLineups(players, constraints);
    return res.status(200).json({ lineups, generatedAt: new Date().toISOString() });
  } catch (error) {
    return next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'internal_server_error', detail: error.message });
});

module.exports = app;
