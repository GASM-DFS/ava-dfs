const fs = require('node:fs');
const path = require('node:path');

const samplePath = path.join(process.cwd(), 'services', 'data', 'sample-players.json');

function loadSamplePlayers() {
  if (!fs.existsSync(samplePath)) {
    return [];
  }

  return JSON.parse(fs.readFileSync(samplePath, 'utf8'));
}

function scorePlayers(players) {
  const source = players.length > 0 ? players : loadSamplePlayers();

  return source.map((player) => {
    const median = Number(player.baseProjection || 0);
    const ceiling = Number(player.ceilingProjection || median * 1.9);
    const ownership = Number(player.ownershipProjection || 0.1);

    return {
      playerId: player.playerId,
      name: player.name,
      team: player.team,
      positions: player.positions || [],
      salary: Number(player.salary || 0),
      quantiles: {
        p10: Number((median * 0.55).toFixed(2)),
        p50: Number(median.toFixed(2)),
        p90: Number(ceiling.toFixed(2))
      },
      ownership: Number(ownership.toFixed(4)),
      leverage: Number((ceiling / Math.max(ownership * 100, 1)).toFixed(4))
    };
  });
}

function buildProjectionResponse(players, slateDate) {
  return {
    slateDate,
    generatedAt: new Date().toISOString(),
    players
  };
}

module.exports = { scorePlayers, buildProjectionResponse, loadSamplePlayers };
