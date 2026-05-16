function trainVarianceModel(trainingRows) {
  return {
    modelType: 'quantile-regression',
    quantiles: [0.1, 0.5, 0.9],
    trainedRows: trainingRows.length,
    trainedAt: new Date().toISOString()
  };
}

module.exports = { trainVarianceModel };
