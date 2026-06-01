function scoreCandidate(player, mode, variance = 0) {
  const median = Number(player.baseProjection || player.quantiles?.p50 || 0);
  const ceiling = Number(player.ceilingProjection || player.quantiles?.p90 || median * 1.8);
  const ownership = Number(player.ownershipProjection || player.ownership || 0.1);

  let baseScore = median;
  if (mode === 'gpp') {
    const leverage = ceiling / Math.max(ownership * 100, 1);
    baseScore = ceiling + leverage;
  }

  if (variance > 0) {
    // Apply random noise between -variance% and +variance% for MME diversity
    const noise = 1 + (Math.random() * variance * 2 - variance);
    return baseScore * noise;
  }

  return baseScore;
}

function buildLineup(players, constraints, exposureState) {
  const salaryCap = Number(constraints.salaryCap || 50000);
  const lineupSize = Number(constraints.lineupSize || 9);
  const mode = constraints.mode === 'cash' ? 'cash' : 'gpp';
  const maxExposure = Number(constraints.maxExposure || 1);
  const variance = mode === 'gpp' ? Number(constraints.variance || 0.15) : 0;

  // Evaluate scores once per lineup generation to maintain stable sorting and introduce variance
  const evaluatedPlayers = players.map(player => ({
    ...player,
    _currentScore: scoreCandidate(player, mode, variance)
  }));

  const sorted = evaluatedPlayers.sort((a, b) => b._currentScore - a._currentScore);
  const lineup = [];
  let salaryUsed = 0;

  for (const player of sorted) {
    const id = String(player.playerId);
    const exposure = exposureState[id] || 0;
    const projectedExposure = (exposure + 1) / Number(constraints.lineupCount || 1);

    if (projectedExposure > maxExposure) {
      continue;
    }

    const salary = Number(player.salary || 0);
    if (salaryUsed + salary > salaryCap) {
      continue;
    }

    lineup.push(player);
    salaryUsed += salary;
    exposureState[id] = exposure + 1;

    if (lineup.length >= lineupSize) {
      break;
    }
  }

  return {
    mode,
    salaryCap,
    salaryUsed,
    players: lineup.map(p => { 
      const { _currentScore, ...rest } = p; 
      return rest; 
    }),
    projection: Number(lineup.reduce((sum, p) => sum + scoreCandidate(p, mode, 0), 0).toFixed(3))
  };
}

function generateLineups(players, constraints = {}) {
  const lineupCount = Number(constraints.lineupCount || 1);
  const exposureState = {};
  const lineups = [];

  for (let i = 0; i < lineupCount; i += 1) {
    const lineup = buildLineup(players, { ...constraints, lineupCount }, exposureState);
    lineups.push({ lineupNumber: i + 1, ...lineup });
  }

  return lineups;
}

module.exports = { generateLineups };
