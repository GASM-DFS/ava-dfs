'use strict';

function calculateMean(arr, key) {
  let sum = 0;
  let count = 0;
  for (const obj of arr) {
    if (typeof obj[key] === 'number' && !isNaN(obj[key])) {
      sum += obj[key];
      count++;
    }
  }
  return count > 0 ? sum / count : null;
}

function detectDrift(referenceData, currentData, threshold = 0.20) {
  if (!Array.isArray(referenceData) || !Array.isArray(currentData)) {
    throw new Error('Data contract violation: Inputs must be JSON arrays.');
  }

  if (referenceData.length === 0 || currentData.length === 0) {
    throw new Error('Cannot detect drift on empty datasets.');
  }

  // Identify all numeric keys from the first object in reference data
  const numericKeys = Object.keys(referenceData[0]).filter(
    key => typeof referenceData[0][key] === 'number'
  );

  const driftReport = [];
  let isDrifting = false;

  for (const key of numericKeys) {
    const refMean = calculateMean(referenceData, key);
    const curMean = calculateMean(currentData, key);

    if (refMean === null || curMean === null) continue;

    // Calculate percentage shift (protecting against zero-division)
    let shiftPercent = 0;
    if (refMean !== 0) {
      shiftPercent = Math.abs((curMean - refMean) / refMean);
    } else if (curMean !== 0) {
      shiftPercent = 1.0; // 100% shift if moving from exactly 0
    }

    const drifted = shiftPercent >= threshold;
    if (drifted) isDrifting = true;

    driftReport.push({
      Feature: key,
      ReferenceMean: parseFloat(refMean.toFixed(4)),
      CurrentMean: parseFloat(curMean.toFixed(4)),
      ShiftPercentage: parseFloat(shiftPercent.toFixed(4)),
      DriftDetected: drifted
    });
  }

  return {
    metadata: {
      referenceSize: referenceData.length,
      currentSize: currentData.length,
      threshold: threshold,
      criticalDrift: isDrifting
    },
    metrics: driftReport.sort((a, b) => b.ShiftPercentage - a.ShiftPercentage)
  };
}

module.exports = { detectDrift, calculateMean };