'use strict';

/**
 * In-memory versioned feature store.
 *
 * Each named feature set stores a list of snapshots { version, data, createdAt }.
 * The latest snapshot is returned by get(); older ones can be retrieved by getVersion()
 * or pruned to keep memory bounded.
 */
class FeatureStore {
  constructor() {
    /** @type {Map<string, Array<{ version: string, data: any, createdAt: number }>>} */
    this._store = new Map();
  }

  /**
   * Store a snapshot.
   * @param {string} name    - feature set name (e.g. 'players')
   * @param {any}    data    - snapshot payload
   * @param {string} [version] - defaults to current Unix ms
   * @returns {string} the version string that was stored
   */
  set(name, data, version) {
    const v = version || Date.now().toString();
    if (!this._store.has(name)) this._store.set(name, []);
    this._store.get(name).push({ version: v, data, createdAt: Date.now() });
    return v;
  }

  /** Return the latest snapshot for `name`, or null if unknown. */
  get(name) {
    const versions = this._store.get(name);
    if (!versions || versions.length === 0) return null;
    return versions[versions.length - 1];
  }

  /** Return a specific snapshot by version string, or null. */
  getVersion(name, version) {
    return (this._store.get(name) || []).find(v => v.version === version) || null;
  }

  /** List all version strings and timestamps for a named feature set. */
  listVersions(name) {
    return (this._store.get(name) || []).map(({ version, createdAt }) => ({ version, createdAt }));
  }

  /** Returns true when the latest snapshot is within `freshnessMs` of now. */
  isFresh(name, freshnessMs) {
    const latest = this.get(name);
    return latest ? Date.now() - latest.createdAt < freshnessMs : false;
  }

  /** Drop all but the `keepLatestN` most recent snapshots for a named feature set. */
  prune(name, keepLatestN = 5) {
    const versions = this._store.get(name);
    if (versions && versions.length > keepLatestN) {
      this._store.set(name, versions.slice(-keepLatestN));
    }
  }

  names() { return [...this._store.keys()]; }
}

module.exports = { FeatureStore };
