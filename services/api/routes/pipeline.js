'use strict';

const { Router }          = require('express');
const { PipelineRunner }  = require('../../pipeline/runner');
const { FeatureStore }    = require('../../features/store');
const { ModelRegistry }   = require('../../inference/models/registry');
const { createIngestJob } = require('../../pipeline/jobs/ingestJob');
const { createValidateJob }     = require('../../pipeline/jobs/validateJob');
const { createFeatureBuildJob } = require('../../pipeline/jobs/featureBuildJob');
const { createInferenceJob }    = require('../../pipeline/jobs/inferenceJob');
const { createOptimizeJob }     = require('../../pipeline/jobs/optimizeJob');
const { registry }        = require('./ingest');
const { workerQueue }     = require('../../workers/queue');
const { logger }          = require('../../observability/logger');

const router        = Router();
let featureStore;
let modelRegistry;

function getFeatureStore() {
  if (featureStore) return featureStore;
  const projectId = process.env.FEATURE_STORE_PROJECT_ID;
  const datasetId = process.env.FEATURE_STORE_DATASET_ID;
  const tableId = process.env.FEATURE_STORE_TABLE_ID;
  if (!projectId || !datasetId || !tableId) return undefined;
  try {
    featureStore = new FeatureStore({
      projectId,
      datasetId,
      tableId,
    });
  } catch (error) {
    logger.warn(
      { error: error.message },
      'Feature store not configured (expected in local/test); skipping persistence'
    );
    return undefined;
  }
  return featureStore;
}

function getModelRegistry() {
  if (modelRegistry) return modelRegistry;
  const bucketName = process.env.MODEL_REGISTRY_BUCKET_NAME;
  const manifestPath = process.env.MODEL_REGISTRY_MANIFEST_PATH;
  if (!bucketName) return undefined;
  try {
    modelRegistry = new ModelRegistry({
      bucketName,
      manifestPath,
    });
  } catch (error) {
    logger.warn(
      { error: error.message },
      'Model registry not configured (expected in local/test); using builtin model'
    );
    return undefined;
  }
  return modelRegistry;
}

const DEFAULT_CONTEST = {
  id:          'dk-nba-default',
  provider:    'draftkings',
  sport:       'nba',
  salaryCap:   50000,
  rosterSlots: ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'],
  type:        'gpp',
};

/**
 * POST /api/v1/pipeline/run
 * Body: { runId, provider, rows, options?, contest?, portfolioOptions? }
 * Response 202: { status: 'accepted', jobId, runId }
 */
router.post('/pipeline/run', (req, res) => {
  const { runId, provider, rows, options = {}, contest = DEFAULT_CONTEST, portfolioOptions = {} } = req.body;

  if (!runId || !provider || !Array.isArray(rows)) {
    return res.status(400).json({ error: '"runId", "provider", and "rows" are required' });
  }

  const jobId = workerQueue.submit(async () => {
    const runner = new PipelineRunner();
    const jobs   = [
      createIngestJob(provider, rows, options, registry),
      createValidateJob(contest),
      createFeatureBuildJob(getFeatureStore()),
      createInferenceJob(getModelRegistry()),
      createOptimizeJob(contest, portfolioOptions),
    ];
    return runner.run(runId, jobs, {});
  });

  logger.info({ tenant: req.tenant?.id, runId, jobId }, 'Pipeline job submitted');
  res.status(202).json({ status: 'accepted', jobId, runId });
});

/**
 * GET /api/v1/pipeline/:jobId
 * Response: worker job state (status, result, error, timing)
 */
router.get('/pipeline/:jobId', (req, res) => {
  const job = workerQueue.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

module.exports = { pipelineRouter: router };
