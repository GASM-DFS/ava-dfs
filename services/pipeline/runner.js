'use strict';

const { logger }  = require('../observability/logger');
const { metrics } = require('../observability/metrics');

const DEFAULT_MAX_RETRIES   = 3;
const DEFAULT_RETRY_DELAY_MS = 500;

/**
 * PipelineRunner orchestrates a sequence of jobs with:
 *  - Sequential execution (each job receives the shared context built by its predecessors)
 *  - Retry with exponential back-off per job
 *  - Idempotency: the same runId is never executed twice
 *  - Fail-fast: the first permanent job failure aborts the whole run
 *
 * @example
 *   const runner = new PipelineRunner();
 *   const result = await runner.run('run-abc', [ingestJob, validateJob, optimizeJob], {});
 */
class PipelineRunner {
  constructor({ maxRetries = DEFAULT_MAX_RETRIES, retryDelayMs = DEFAULT_RETRY_DELAY_MS } = {}) {
    this.maxRetries   = maxRetries;
    this.retryDelayMs = retryDelayMs;
    /** @type {Map<string, { completedAt: number, ctx: object }>} */
    this._completedRuns = new Map();
  }

  /**
   * Execute a pipeline run.
   * @param {string}        runId  - unique ID; re-submitting the same ID is a no-op
   * @param {Array<object>} jobs   - each job: { name: string, run: (ctx) => Promise<any> }
   * @param {object}        ctx    - mutable shared context; each job result is merged in as ctx[job.name]
   * @returns {Promise<{ runId, status, jobs, ctx, skipped? }>}
   */
  async run(runId, jobs, ctx = {}) {
    if (this._completedRuns.has(runId)) {
      logger.info({ runId }, 'Pipeline already completed — idempotent skip');
      return { runId, status: 'ok', jobs: [], ctx: this._completedRuns.get(runId).ctx, skipped: true };
    }

    logger.info({ runId, jobCount: jobs.length }, 'Pipeline run started');
    const startTime  = Date.now();
    const jobResults = [];
    let   overallStatus = 'ok';

    for (const job of jobs) {
      const jobResult = await this._runJob(job, ctx, runId);
      jobResults.push(jobResult);
      metrics.increment(`pipeline.job.${jobResult.status}`, { job: job.name });

      if (jobResult.status === 'error') {
        overallStatus = 'error';
        logger.error({ runId, job: job.name, error: jobResult.error }, 'Job failed — aborting pipeline');
        break; // fail-fast
      }

      // Merge job result into shared context for downstream jobs
      if (jobResult.result !== undefined) {
        ctx[job.name] = jobResult.result;
      }
    }

    const duration = Date.now() - startTime;
    metrics.histogram('pipeline.run.duration', duration);
    logger.info({ runId, status: overallStatus, duration }, 'Pipeline run finished');

    if (overallStatus === 'ok') {
      this._completedRuns.set(runId, { completedAt: Date.now(), ctx });
    }

    return { runId, status: overallStatus, jobs: jobResults, ctx };
  }

  /** Run a single job with retry and exponential back-off. */
  async _runJob(job, ctx, runId) {
    const start    = Date.now();
    let   lastError;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.debug({ runId, job: job.name, attempt }, 'Job attempt');
        const result   = await job.run(ctx);
        const duration = Date.now() - start;
        metrics.histogram('pipeline.job.duration', duration, { job: job.name });
        return { jobName: job.name, status: 'ok', duration, result };
      } catch (err) {
        lastError = err;
        logger.warn({ runId, job: job.name, attempt, error: err.message }, 'Job attempt failed');
        if (attempt < this.maxRetries) {
          await this._sleep(this.retryDelayMs * attempt); // exponential back-off
        }
      }
    }

    return {
      jobName:  job.name,
      status:   'error',
      duration: Date.now() - start,
      error:    lastError?.message || 'unknown error',
    };
  }

  /** Check whether a completed run is still fresh within a given window. */
  isFresh(runId, freshnessMs) {
    const run = this._completedRuns.get(runId);
    return run ? Date.now() - run.completedAt < freshnessMs : false;
  }

  clearCompleted(runId) { this._completedRuns.delete(runId); }

  _sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
}

module.exports = { PipelineRunner };
