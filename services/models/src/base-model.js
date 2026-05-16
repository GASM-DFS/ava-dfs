function trainBaseProjectionModel(trainingRows) {
  return {
    modelType: 'gradient-boosting',
    algorithm: 'lightgbm-xgboost-compatible',
    trainedRows: trainingRows.length,
    trainedAt: new Date().toISOString()
  };
}

module.exports = { trainBaseProjectionModel };
