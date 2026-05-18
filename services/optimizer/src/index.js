function scoreCandidate(player, mode) {
  const median = Number(player.baseProjection || player.quantiles?.p50 || 0);
  const ceiling = Number(player.ceilingProjection || player.quantiles?.p90 || median * 1.8);
  const ownership = Number(player.ownershipProjection || player.ownership || 0.1);

  if (mode === 'gpp') {
    const leverage = ceiling / Math.max(ownership * 100, 1);
    return ceiling + leverage;
  }

  return median;
}

function buildLineup(players, constraints, exposureState) {
  const salaryCap = Number(constraints.salaryCap || 50000);
  const lineupSize = Number(constraints.lineupSize || 9);
  const mode = constraints.mode === 'cash' ? 'cash' : 'gpp';
  const maxExposure = Number(constraints.maxExposure || 1);

  const sorted = [...players].sort((a, b) => scoreCandidate(b, mode) - scoreCandidate(a, mode));
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
    players: lineup,
    projection: Number(lineup.reduce((sum, p) => sum + scoreCandidate(p, mode), 0).toFixed(3))
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
