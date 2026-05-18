'use strict';

const { randomUUID } = require('crypto');

/** Normalise a player name for matching: lowercase, strip non-alphanumeric, collapse whitespace. */
function normalizeName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Jaro similarity between two strings — returns a value in [0, 1].
 * Used as the fuzzy-match backbone; prefer exact alias hits first.
 */
function jaroSimilarity(s1, s2) {
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const maxDist = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);
  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - maxDist);
    const end   = Math.min(i + maxDist + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  return (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;
}

/**
 * PlayerRegistry manages stable player IDs and alias resolution.
 *
 * Design intent:
 *  - Every unique player has one UUID that survives provider renames.
 *  - Names are matched via a normalised alias index first (O(1)), then Jaro fuzzy match.
 *  - Fuzzy hits below `fuzzyThreshold` are not auto-accepted; callers receive confidence = 0.
 */
class PlayerRegistry {
  constructor() {
    /** @type {Map<string, { id: string, name: string, team: string, position: string, aliases: Set<string> }>} */
    this._byId       = new Map();
    /** @type {Map<string, string>} normalizedAlias -> id */
    this._aliasIndex = new Map();
  }

  /**
   * Register a new player. Returns their stable ID.
   * If a normalised alias already exists, returns the existing player's ID (idempotent).
   */
  register(name, team, position) {
    const normalized = normalizeName(name);
    if (this._aliasIndex.has(normalized)) return this._aliasIndex.get(normalized);

    const id    = randomUUID();
    const entry = { id, name, team, position, aliases: new Set([normalized]) };
    this._byId.set(id, entry);
    this._aliasIndex.set(normalized, id);
    return id;
  }

  /** Add an alternative name mapping for an existing player. */
  addAlias(id, alias) {
    const entry = this._byId.get(id);
    if (!entry) throw new Error(`Unknown player ID: ${id}`);
    const normalized = normalizeName(alias);
    entry.aliases.add(normalized);
    this._aliasIndex.set(normalized, id);
  }

  /**
   * Resolve a display name to a stable player ID.
   * Returns `{ id, confidence }`:
   *   - confidence === 1.0  → exact alias hit
   *   - confidence in (threshold, 1)  → fuzzy hit above threshold
   *   - id === null, confidence === 0  → no match
   */
  resolve(name, { fuzzyThreshold = 0.85 } = {}) {
    const normalized = normalizeName(name);

    if (this._aliasIndex.has(normalized)) {
      return { id: this._aliasIndex.get(normalized), confidence: 1.0 };
    }

    let bestId    = null;
    let bestScore = 0;
    for (const [alias, id] of this._aliasIndex) {
      const score = jaroSimilarity(normalized, alias);
      if (score > bestScore) { bestScore = score; bestId = id; }
    }

    if (bestId && bestScore >= fuzzyThreshold) {
      return { id: bestId, confidence: bestScore };
    }
    return { id: null, confidence: 0 };
  }

  getById(id)  { return this._byId.get(id) || null; }
  size()       { return this._byId.size; }

  /** Serialise to a plain array for persistence. */
  export() {
    return [...this._byId.values()].map(e => ({ ...e, aliases: [...e.aliases] }));
  }

  /** Hydrate from a previously exported snapshot. */
  import(entries) {
    for (const entry of entries) {
      const e = { ...entry, aliases: new Set(entry.aliases) };
      this._byId.set(e.id, e);
      for (const alias of e.aliases) this._aliasIndex.set(alias, e.id);
    }
  }
}

module.exports = { PlayerRegistry, normalizeName, jaroSimilarity };
