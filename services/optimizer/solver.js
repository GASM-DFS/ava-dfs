'use strict';

const { isEligibleForSlot } = require('./slots');

/**
 * Solve for a single optimal lineup using a backtracking search.
 *
 * Algorithm:
 *  1. Build a candidate list per slot, sorted descending by scoreKey.
 *  2. Sort slots by fewest candidates first (most-constrained-variable heuristic).
 *  3. Recurse: for each slot pick the best eligible player that fits the remaining salary.
 *  4. Return the first complete assignment found (greedy-optimal under the sort order).
 *
 * @param {object[]} players
 * @param {{ salaryCap: number, rosterSlots: string[] }} contest
 * @param {{ scoreKey?: string }} [opts]
 * @returns {{ players: object[], totalSalary: number, totalProjected: number } | null}
 */
function solveLineup(players, contest, { scoreKey = 'projectedPoints' } = {}) {
  const { salaryCap, rosterSlots } = contest;

  const slotCandidates = rosterSlots.map(slot => ({
    slot,
    candidates: players
      .filter(p => isEligibleForSlot(p.position, slot) && p[scoreKey] != null)
      .sort((a, b) => (b[scoreKey] || 0) - (a[scoreKey] || 0)),
  }));

  // Most-constrained first: slots with fewer candidates are filled first to prune early
  slotCandidates.sort((a, b) => a.candidates.length - b.candidates.length);

  const selected = backtrack(slotCandidates, 0, [], salaryCap, new Set());
  if (!selected) return null;

  const totalSalary    = selected.reduce((s, p) => s + p.salary, 0);
  const totalProjected = selected.reduce((s, p) => s + (p[scoreKey] || 0), 0);

  return { players: selected, totalSalary, totalProjected };
}

function backtrack(slotCandidates, slotIdx, selected, remainingSalary, usedIds) {
  if (slotIdx === slotCandidates.length) return selected;

  for (const player of slotCandidates[slotIdx].candidates) {
    if (usedIds.has(player.id))     continue;
    if (player.salary > remainingSalary) continue;

    usedIds.add(player.id);
    selected.push(player);

    const result = backtrack(slotCandidates, slotIdx + 1, selected, remainingSalary - player.salary, usedIds);
    if (result) return result;

    selected.pop();
    usedIds.delete(player.id);
  }

  return null;
}

module.exports = { solveLineup };
