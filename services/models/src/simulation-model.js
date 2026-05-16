function runMonteCarlo({ players, simulationCount = 10000 }) {
  return {
    simulationCount,
    correlations: players.map((player) => ({
      playerId: player.playerId,
      team: player.team,
      stackCorrelation: Number((Math.random() * 0.75 + 0.2).toFixed(4))
    })),
    generatedAt: new Date().toISOString()
  };
}

module.exports = { runMonteCarlo };
