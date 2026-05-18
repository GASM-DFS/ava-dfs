'use strict';

const { randomUUID } = require('crypto');
const { logger }     = require('../observability/logger');

const STATUS = { PENDING: 'pending', RUNNING: 'running', DONE: 'done', ERROR: 'error' };

/**
 * Simple async worker queue with configurable concurrency.
 *
 * Jobs are submitted as async functions.  The queue executes up to `concurrency`
 * jobs in parallel and drains the backlog automatically.  Each job is tracked by
 * a UUID so callers can poll for completion.
 */
class WorkerQueue {
  constructor({ concurrency = 2 } = {}) {
    this.concurrency = concurrency;
    this._queue      = [];
    this._jobs       = new Map(); // jobId -> state
    this._running    = 0;
  }

  /**
   * Submit an async function.  Returns a jobId that can be passed to getJob().
   * @param {() => Promise<any>} fn
   * @returns {string} jobId
   */
  submit(fn) {
    const jobId = randomUUID();
    this._jobs.set(jobId, {
      id:          jobId,
      status:      STATUS.PENDING,
      submittedAt: Date.now(),
      startedAt:   null,
      completedAt: null,
      result:      null,
      error:       null,
    });
    this._queue.push({ jobId, fn });
    this._drain();
    return jobId;
  }

  /** Return the current state of a job, or null if unknown. */
  getJob(jobId) { return this._jobs.get(jobId) || null; }

  stats() {
    const jobs = [...this._jobs.values()];
    return {
      total:   jobs.length,
      pending: jobs.filter(j => j.status === STATUS.PENDING).length,
      running: jobs.filter(j => j.status === STATUS.RUNNING).length,
      done:    jobs.filter(j => j.status === STATUS.DONE).length,
      error:   jobs.filter(j => j.status === STATUS.ERROR).length,
    };
  }

  _drain() {
    while (this._running < this.concurrency && this._queue.length > 0) {
      const { jobId, fn } = this._queue.shift();
      this._execute(jobId, fn);
    }
  }

  async _execute(jobId, fn) {
    const job      = this._jobs.get(jobId);
    job.status     = STATUS.RUNNING;
    job.startedAt  = Date.now();
    this._running++;

    try {
      job.result = await fn();
      job.status = STATUS.DONE;
      logger.info({ jobId }, 'Worker job completed');
    } catch (err) {
      job.error  = err.message;
      job.status = STATUS.ERROR;
      logger.error({ jobId, error: err.message }, 'Worker job failed');
    } finally {
      job.completedAt = Date.now();
      this._running--;
      this._drain();
    }
  }
}

const workerQueue = new WorkerQueue();

module.exports = { WorkerQueue, workerQueue, JOB_STATUS: STATUS };
