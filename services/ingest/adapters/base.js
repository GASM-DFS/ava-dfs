'use strict';

/**
 * Abstract base class for provider adapters.
 * Subclasses must implement transform().
 */
class BaseAdapter {
  constructor(name) {
    if (new.target === BaseAdapter) throw new Error('BaseAdapter is abstract');
    this.name = name;
  }

  /**
   * Transform raw provider data into canonical player objects.
   * @param {Array<object>} rows - parsed rows (from CSV or JSON)
   * @param {object} [options]
   * @returns {Array<object>} canonical player objects
   */
  // eslint-disable-next-line no-unused-vars
  transform(rows, options) {
    throw new Error(`${this.constructor.name}.transform() not implemented`);
  }

  /** Assert required fields are present and non-empty. */
  _requireFields(row, fields) {
    const missing = fields.filter(f => row[f] === undefined || row[f] === null || row[f] === '');
    if (missing.length > 0) throw new Error(`Missing required fields: ${missing.join(', ')}`);
  }

  /** Parse "$6,500" or 6500 to a numeric salary. */
  _parseSalary(str) {
    if (typeof str === 'number') return str;
    return Number(String(str).replace(/[^0-9.]/g, ''));
  }
}

module.exports = { BaseAdapter };
