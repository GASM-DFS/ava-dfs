'use strict';

const { test }   = require('node:test');
const assert     = require('node:assert/strict');
const { PlayerRegistry, normalizeName, jaroSimilarity } = require('../../services/ingest/playerRegistry');

test('normalizeName strips punctuation and lowercases', () => {
  assert.equal(normalizeName('LeBron James'),       'lebron james');
  assert.equal(normalizeName("D'Angelo Russell"),   'dangelo russell');
  assert.equal(normalizeName('  Luka  Doncic  '),   'luka doncic');
});

test('jaroSimilarity returns 1 for identical strings', () => {
  assert.equal(jaroSimilarity('abc', 'abc'), 1);
});

test('jaroSimilarity returns < 0.5 for completely different strings', () => {
  assert.ok(jaroSimilarity('abc', 'xyz') < 0.5);
});

test('PlayerRegistry registers a player and resolves exact match', () => {
  const reg = new PlayerRegistry();
  const id  = reg.register('LeBron James', 'LAL', 'SF');
  assert.ok(id);
  assert.equal(reg.size(), 1);

  const resolved = reg.resolve('LeBron James');
  assert.equal(resolved.id,         id);
  assert.equal(resolved.confidence, 1.0);
});

test('PlayerRegistry register is idempotent for the same name', () => {
  const reg = new PlayerRegistry();
  const id1 = reg.register('Stephen Curry', 'GSW', 'PG');
  const id2 = reg.register('Stephen Curry', 'GSW', 'PG');
  assert.equal(id1, id2);
  assert.equal(reg.size(), 1);
});

test('PlayerRegistry resolves via added alias', () => {
  const reg = new PlayerRegistry();
  const id  = reg.register('LeBron James', 'LAL', 'SF');
  reg.addAlias(id, 'Bron');

  const resolved = reg.resolve('bron');
  assert.equal(resolved.id,         id);
  assert.equal(resolved.confidence, 1.0);
});

test('PlayerRegistry returns null for unmatched names below threshold', () => {
  const reg = new PlayerRegistry();
  reg.register('LeBron James', 'LAL', 'SF');

  const resolved = reg.resolve('Completely Different Name');
  assert.equal(resolved.id,         null);
  assert.equal(resolved.confidence, 0);
});

test('PlayerRegistry getById returns the registered entry', () => {
  const reg = new PlayerRegistry();
  const id  = reg.register('Klay Thompson', 'GSW', 'SG');
  const entry = reg.getById(id);
  assert.ok(entry);
  assert.equal(entry.name, 'Klay Thompson');
});

test('PlayerRegistry export / import round-trips correctly', () => {
  const reg1 = new PlayerRegistry();
  reg1.register('Stephen Curry', 'GSW', 'PG');
  reg1.register('Klay Thompson', 'GSW', 'SG');

  const reg2 = new PlayerRegistry();
  reg2.import(reg1.export());

  assert.equal(reg2.size(), 2);
  const r = reg2.resolve('Stephen Curry');
  assert.ok(r.id);
  assert.equal(r.confidence, 1.0);
});
