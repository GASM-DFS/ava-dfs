'use strict';

const { test }  = require('node:test');
const assert    = require('node:assert/strict');
const { PipelineRunner } = require('../../services/pipeline/runner');

test('PipelineRunner runs jobs in sequence and merges results into context', async () => {
  const runner = new PipelineRunner({ maxRetries: 1 });
  const jobs   = [
    { name: 'jobA', run: async ()      => ({ x: 1 }) },
    { name: 'jobB', run: async (ctx)   => { assert.ok(ctx.jobA); return { y: 2 }; } },
  ];

  const result = await runner.run('seq-run-1', jobs, {});
  assert.equal(result.status,       'ok');
  assert.equal(result.jobs.length,  2);
  assert.equal(result.ctx.jobA.x,   1);
  assert.equal(result.ctx.jobB.y,   2);
});

test('PipelineRunner fails fast on job error', async () => {
  const runner = new PipelineRunner({ maxRetries: 1, retryDelayMs: 0 });
  let secondJobRan = false;
  const jobs   = [
    { name: 'bad',  run: async () => { throw new Error('boom'); } },
    { name: 'good', run: async () => { secondJobRan = true; return {}; } },
  ];

  const result = await runner.run('fail-fast-1', jobs, {});
  assert.equal(result.status,           'error');
  assert.equal(result.jobs[0].status,   'error');
  assert.equal(result.jobs.length,      1); // second job never ran
  assert.equal(secondJobRan,            false);
});

test('PipelineRunner is idempotent for the same runId', async () => {
  const runner    = new PipelineRunner({ maxRetries: 1 });
  let callCount   = 0;
  const jobs      = [{ name: 'j', run: async () => { callCount++; return {}; } }];

  await runner.run('idem-1', jobs, {});
  const second = await runner.run('idem-1', jobs, {});

  assert.equal(callCount,     1);
  assert.equal(second.skipped, true);
});

test('PipelineRunner retries a flaky job until it succeeds', async () => {
  const runner  = new PipelineRunner({ maxRetries: 3, retryDelayMs: 0 });
  let attempts  = 0;
  const jobs    = [{
    name: 'flaky',
    run: async () => {
      attempts++;
      if (attempts < 3) throw new Error('transient');
      return { done: true };
    },
  }];

  const result = await runner.run('retry-1', jobs, {});
  assert.equal(result.status,  'ok');
  assert.equal(attempts,       3);
});

test('PipelineRunner exhausts retries and reports error', async () => {
  const runner = new PipelineRunner({ maxRetries: 2, retryDelayMs: 0 });
  let attempts = 0;
  const jobs   = [{
    name: 'always-fail',
    run: async () => { attempts++; throw new Error('permanent'); },
  }];

  const result = await runner.run('exhaust-1', jobs, {});
  assert.equal(result.status,         'error');
  assert.equal(result.jobs[0].status, 'error');
  assert.equal(attempts,              2);
});
