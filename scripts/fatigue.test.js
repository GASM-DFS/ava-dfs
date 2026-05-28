'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { haversineMiles } = require('../services/ingestors/fatigue');

describe('Fatigue Ingestor: Haversine Formula', () => {
  
  it('should return 0 distance for the exact same coordinates', () => {
    const dist = haversineMiles(40.7128, -74.0060, 40.7128, -74.0060);
    assert.strictEqual(dist, 0, 'Distance between the same points should be exactly 0');
  });

  it('should accurately calculate the distance between New York and Los Angeles', () => {
    // Coordinates for New York City (JFK) and Los Angeles (LAX)
    const dist = haversineMiles(40.6413, -73.7781, 33.9416, -118.4085);
    
    // The real-world great-circle distance is roughly 2,469 miles.
    // We assert that the calculation is within a 5-mile delta to account for Earth radius approximations.
    assert.ok(Math.abs(dist - 2469) < 5, `Calculated distance ${dist} is outside the acceptable tolerance`);
  });

  it('should calculate 1 degree of longitude at the equator as ~69.1 miles', () => {
    const dist = haversineMiles(0, 0, 0, 1);
    assert.ok(Math.abs(dist - 69.09) < 0.1, `Calculated distance ${dist} is outside the acceptable tolerance`);
  });

});