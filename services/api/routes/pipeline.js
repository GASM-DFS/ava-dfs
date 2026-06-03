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
  if (featureStore !== undefined) return featureStore;
  try {
    featureStore = new FeatureStore({
      projectId: process.env.FEATURE_STORE_PROJECT_ID,
      datasetId: process.env.FEATURE_STORE_DATASET_ID,
      tableId: process.env.FEATURE_STORE_TABLE_ID,
    });
  } catch (error) {
    featureStore = null;
    logger.warn({ error: error.message }, 'Feature store not configured; skipping persistence');
  }
  return featureStore;
}

function getModelRegistry() {
  if (modelRegistry !== undefined) return modelRegistry;
  try {
    modelRegistry = new ModelRegistry({
      bucketName: process.env.MODEL_REGISTRY_BUCKET_NAME,
      manifestPath: process.env.MODEL_REGISTRY_MANIFEST_PATH,
    });
  } catch (error) {
    modelRegistry = null;
    logger.warn({ error: error.message }, 'Model registry not configured; using builtin model');
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
