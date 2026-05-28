'use strict';

const solver = require('javascript-lp-solver');
const { isEligibleForSlot } = require('./slots');

/**
 * Solve for a single optimal lineup using an Integer Linear Programming (ILP) solver.
 *
 * @param {object[]} players
 * @param {{ salaryCap: number, rosterSlots: string[], maxPlayersPerTeam?: number }} contest
 * @param {{ scoreKey?: string }} [opts]
 * @returns {{ players: object[], totalSalary: number, totalProjected: number } | null}
 */
function solveLineup(players, contest, { scoreKey = 'projectedPoints', lockedIds = [], excludedIds = [] } = {}) {
  const { salaryCap, rosterSlots, maxPlayersPerTeam = 3 } = contest;

  const model = {
    optimize: 'score',
    opType: 'max',
    constraints: {
      salary: { max: salaryCap },
    },
    variables: {},
    ints: {}
  };

  // Constraint: Exactly 1 player must be assigned to each specific roster slot index
  rosterSlots.forEach((slot, idx) => {
    model.constraints[`slot_${idx}`] = { equal: 1 };
  });

  // Constraint: A player can only be drafted once per lineup
  players.forEach(p => {
    if (lockedIds.includes(String(p.id))) {
      model.constraints[`player_${p.id}`] = { equal: 1 };
    } else {
      model.constraints[`player_${p.id}`] = { max: 1 };
    }
  });

  // Constraint: Maximum players from the same real-world team
  const teams = [...new Set(players.map(p => p.team || p.TeamAbbrev).filter(Boolean))];
  teams.forEach(team => {
    model.constraints[`team_${team}`] = { max: maxPlayersPerTeam };
  });

  // Constraint: Correlations (e.g., if a PG from Team A is drafted, a C from Team A must also be drafted)
  // Utilizing a Big-M formulation: Primary - (M * Secondary) <= 0
  if (contest.correlations && contest.correlations.length > 0) {
    teams.forEach(team => {
      contest.correlations.forEach(corr => {
        model.constraints[`corr_${team}_${corr.primary}_${corr.secondary}`] = { max: 0 };
      });
    });
  }

  // Map the player pool into mathematical variables
  const playerMap = new Map();
  players.forEach(p => {
    // Skip players we specifically want to exclude (e.g., missed lock time)
    if (excludedIds.includes(String(p.id))) return;

    // Fallback to fpts if projectedPoints isn't found (used by portfolio/CLI)
    const score = p[scoreKey] != null ? p[scoreKey] : (p.fpts || 0);
    if (!score) return;
    
    playerMap.set(String(p.id), p);
    const team = p.team || p.TeamAbbrev;

    rosterSlots.forEach((slot, idx) => {
      if (isEligibleForSlot(p.position, slot)) {
        // Variable format: "playerId:::slotIndex"
        const varName = `${p.id}:::${idx}`;
        
        model.variables[varName] = {
          score: score,
          salary: p.salary,
          [`slot_${idx}`]: 1,
          [`player_${p.id}`]: 1
        };

        if (team) {
          // Exclude MLB Pitchers from team limits to legally permit 5-man hitting stacks
          if (!['P', 'SP', 'RP'].includes(p.position)) {
            model.variables[varName][`team_${team}`] = 1;
          }

          // Inject Big-M correlation stack values
          if (contest.correlations) {
            contest.correlations.forEach(corr => {
              const isPrimary   = isEligibleForSlot(p.position, corr.primary);
              const isSecondary = isEligibleForSlot(p.position, corr.secondary);
              const corrKey     = `corr_${team}_${corr.primary}_${corr.secondary}`;
              
              if (isPrimary && !isSecondary) {
                model.variables[varName][corrKey] = 1;
              } else if (isSecondary && !isPrimary) {
                model.variables[varName][corrKey] = -maxPlayersPerTeam; // Big-M
              }
            });
          }
        }

        // Force the solver to treat this as a binary choice (0 or 1)
        model.ints[varName] = 1;
      }
    });
  });

  // Execute the linear programming solver
  const results = solver.Solve(model);
  if (!results.feasible) return null;

  const selected = [];
  let totalSalary = 0;
  let totalProjected = 0;

  // Extract the drafted players from the matrix
  for (const [key, val] of Object.entries(results)) {
    if (val === 1 && key.includes(':::')) {
      const [id, slotIdx] = key.split(':::');
      const player = playerMap.get(id);
      if (player) {
        const score = player[scoreKey] != null ? player[scoreKey] : (player.fpts || 0);
        // Assign the strict slot for later Google Sheets formatting
        selected.push({ ...player, assignedSlot: rosterSlots[slotIdx] });
        totalSalary += player.salary;
        totalProjected += score;
      }
    }
  }

  // Defensive check: Ensure the solver actually filled all slots
  if (selected.length !== rosterSlots.length) return null;

  return { players: selected, totalSalary, totalProjected };
}

module.exports = { solveLineup };
