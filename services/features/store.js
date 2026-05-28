'use strict';

const { BigQuery } = require('@google-cloud/bigquery');

/**
 * A versioned feature store backed by Google BigQuery.
 *
 * Assumes a BigQuery table with the following schema:
 *   - feature_set_name: STRING
 *   - version:            STRING
 *   - data:               JSON (or STRING)
 *   - created_at:         TIMESTAMP
 */
class FeatureStore {
  /**
   * @param {object} options
   * @param {string} options.projectId - GCP Project ID
   * @param {string} options.datasetId - BigQuery Dataset ID
   * @param {string} options.tableId   - BigQuery Table ID for the feature store
   */
  constructor({ projectId, datasetId, tableId }) {
    if (!projectId || !datasetId || !tableId) {
      throw new Error('FeatureStore requires projectId, datasetId, and tableId');
    }
    this.bigquery = new BigQuery({ projectId });
    this.datasetId = datasetId;
    this.tableId = tableId;
    this.tableRef = this.bigquery.dataset(this.datasetId).table(this.tableId);
  }

  /**
   * Helper to format BigQuery rows back into the expected snapshot object.
   */
  _formatRow(row) {
    if (!row) return null;
    return {
      version: row.version,
      data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
      createdAt: row.created_at.value // Convert BQ timestamp to ISO string
    };
  }

  /**
   * Store a snapshot.
   * @param {string} name    - feature set name (e.g. 'players')
   * @param {any}    data    - snapshot payload
   * @param {string} [version] - defaults to current Unix ms
   * @returns {Promise<string>} the version string that was stored
   */
  async set(name, data, version) {
    const v = version || Date.now().toString();
    const row = {
      feature_set_name: name,
      version: v,
      data: JSON.stringify(data),
      created_at: new BigQuery.Timestamp(new Date()),
    };
    await this.tableRef.insert(row);
    return v;
  }

  /** Return the latest snapshot for `name`, or null if unknown. */
  async get(name) {
    const query = `
      SELECT * FROM \`${this.tableRef.id}\`
      WHERE feature_set_name = @name
      ORDER BY created_at DESC
      LIMIT 1`;
    const options = { query, params: { name } };
    const [rows] = await this.bigquery.query(options);
    return this._formatRow(rows[0]);
  }

  /** Return a specific snapshot by version string, or null. */
  async getVersion(name, version) {
    const query = `
      SELECT * FROM \`${this.tableRef.id}\`
      WHERE feature_set_name = @name AND version = @version
      LIMIT 1`;
    const options = { query, params: { name, version } };
    const [rows] = await this.bigquery.query(options);
    return this._formatRow(rows[0]);
  }

  /** List all version strings and timestamps for a named feature set. */
  async listVersions(name) {
    const query = `
      SELECT version, created_at FROM \`${this.tableRef.id}\`
      WHERE feature_set_name = @name
      ORDER BY created_at ASC`;
    const options = { query, params: { name } };
    const [rows] = await this.bigquery.query(options);
    return rows.map(r => ({ version: r.version, createdAt: r.created_at.value }));
  }

  /** Returns true when the latest snapshot is within `freshnessMs` of now. */
  async isFresh(name, freshnessMs) {
    const latest = await this.get(name);
    return latest ? Date.now() - new Date(latest.createdAt).getTime() < freshnessMs : false;
  }

  /** Drop all but the `keepLatestN` most recent snapshots for a named feature set. */
  async prune(name, keepLatestN = 5) {
    const query = `
      DELETE FROM \`${this.tableRef.id}\`
      WHERE feature_set_name = @name AND version NOT IN (
        SELECT version FROM \`${this.tableRef.id}\`
        WHERE feature_set_name = @name
        ORDER BY created_at DESC
        LIMIT @keepLatestN
      )`;
    const options = { query, params: { name, keepLatestN } };
    await this.bigquery.query(options);
  }

  /** Returns an array of all distinct feature set names. */
  async names() {
    const query = `SELECT DISTINCT feature_set_name FROM \`${this.tableRef.id}\``;
    const [rows] = await this.bigquery.query({ query });
    return rows.map(r => r.feature_set_name);
  }
}

module.exports = { FeatureStore };
