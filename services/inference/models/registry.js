'use strict';

/**
 * In-memory model artifact registry.
 * In production this would read from an object-storage manifest, but the interface
 * is stable so callers don't need to change when the backing store does.
 */
class ModelRegistry {
  constructor() {
    /** @type {Map<string, { version: string, metadata: object, registeredAt: number }>} */
    this._models = new Map();
  }

  register(version, metadata = {}) {
    this._models.set(version, { version, metadata, registeredAt: Date.now() });
  }

  get(version) {
    return this._models.get(version) || null;
  }

  latestVersion() {
    if (this._models.size === 0) return 'builtin-v1';
    const versions = [...this._models.keys()].sort();
    return versions[versions.length - 1];
  }

  list() {
    return [...this._models.values()].sort((a, b) => a.registeredAt - b.registeredAt);
  }
}

module.exports = { ModelRegistry };
