'use strict';

const { Storage } = require('@google-cloud/storage');

/**
 * Google Cloud Storage-backed model artifact registry.
 */
class ModelRegistry {
  /**
   * @param {object} options
   * @param {string} options.bucketName - The GCS bucket name to store the registry manifest.
   * @param {string} [options.manifestPath='model-registry-manifest.json'] - The path to the manifest file in the bucket.
   */
  constructor({ bucketName, manifestPath = 'model-registry-manifest.json' }) {
    if (!bucketName) {
      throw new Error('ModelRegistry requires a bucketName');
    }
    this.storage = new Storage();
    this.bucket = this.storage.bucket(bucketName);
    this.manifestFile = this.bucket.file(manifestPath);
  }

  async _loadManifest() {
    try {
      const [exists] = await this.manifestFile.exists();
      if (!exists) {
        return {};
      }
      const [contents] = await this.manifestFile.download();
      return JSON.parse(contents.toString('utf8'));
    } catch (error) {
      throw new Error(`Failed to load model registry manifest: ${error.message}`);
    }
  }

  async _saveManifest(data) {
    try {
      await this.manifestFile.save(JSON.stringify(data, null, 2), {
        contentType: 'application/json',
      });
    } catch (error) {
      throw new Error(`Failed to save model registry manifest: ${error.message}`);
    }
  }

  async register(version, metadata = {}) {
    const manifest = await this._loadManifest();
    manifest[version] = { version, metadata, registeredAt: Date.now() };
    await this._saveManifest(manifest);
  }

  async get(version) {
    const manifest = await this._loadManifest();
    return manifest[version] || null;
  }

  async latestVersion() {
    const manifest = await this._loadManifest();
    const versions = Object.keys(manifest);
    if (versions.length === 0) return 'builtin-v1';
    versions.sort();
    return versions[versions.length - 1];
  }

  async list() {
    const manifest = await this._loadManifest();
    return Object.values(manifest).sort((a, b) => a.registeredAt - b.registeredAt);
  }
}

module.exports = { ModelRegistry };
