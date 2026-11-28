import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { it } from 'node:test';
import { HfS3ConflictError } from '../hf-s3';
import { advanceHpoiPurchaseJob, type HpoiPurchaseSource, startHpoiPurchaseJob } from './purchases-job';
import type { HpoiPurchase } from './purchases-schema';
import { createHpoiPurchaseStore } from './purchases-store';

const reference = (id: number) => ({ figureId: String(id), itemId: String(id + 100), title: `Figure ${id}` });
const record = (id: number): HpoiPurchase => ({
  ...reference(id),
  collectionId: String(id + 200),
  state: 'buy',
  stateLabel: '已入',
  orderTime: null,
  orderWay: null,
  orderMoney: null,
  orderMoneyCurrency: 'rmb',
  currencyLabel: '人民币',
  orderForm: '2',
  orderFormLabel: '现货',
  tags: null,
  comment: null,
});
function memoryStore() {
  let object: { bytes: Uint8Array; etag: string; contentType: string; contentLength: number } | null = null;
  return createHpoiPurchaseStore('1', {
    async get() {
      return object;
    },
    async put(_key, bytes, contentType, condition) {
      if ((object && condition?.ifMatch !== object.etag) || (!object && condition?.ifNoneMatch !== '*'))
        throw new HfS3ConflictError('Conflict');
      object = { bytes, etag: randomUUID(), contentType, contentLength: bytes.length };
    },
  });
}

it('checkpoints bounded work, retains the previous snapshot on failure and resumes without rereading successful details', async () => {
  const store = memoryStore();
  const old = { fetchedAt: '2026-01-01T00:00:00.000Z', records: [record(9)] };
  await store.edit(() => ({ version: 1, revision: randomUUID(), sourceUserId: '1', snapshot: old, job: null }));
  const reads: string[] = [];
  let fail = true;
  const source: HpoiPurchaseSource = {
    async verifyOwner() {},
    async discover(page) {
      return { references: page === 1 ? [reference(1), reference(2)] : [reference(3)], pages: 2 };
    },
    async read(ref) {
      reads.push(ref.figureId);
      if (fail && ref.figureId === '2') throw new Error('Private upstream body must not be persisted');
      return record(Number(ref.figureId));
    },
  };
  const started = await startHpoiPurchaseJob(store, source, '1');
  assert.ok(started?.job);
  const jobId = started.job.id;
  await advanceHpoiPurchaseJob(store, source, jobId);
  assert.deepEqual(reads, ['1']);
  const failed = await advanceHpoiPurchaseJob(store, source, jobId);
  assert.equal(failed?.job?.error, 'upstream');
  assert.equal(failed?.job?.next, 1);
  assert.deepEqual(failed?.snapshot, old);
  assert.ok(!JSON.stringify(failed).includes('Private upstream body'));
  assert.equal((await startHpoiPurchaseJob(store, source, '1'))?.job?.id, jobId);
  fail = false;
  const done = await advanceHpoiPurchaseJob(store, source, jobId);
  assert.equal(done?.job, null);
  assert.deepEqual(
    done?.snapshot?.records.map((value) => value.collectionId),
    ['201', '202', '203'],
  );
  assert.deepEqual(reads, ['1', '2', '2', '3']);
});

it('an explicit restart replaces only the matching inactive job and preserves the last complete snapshot', async () => {
  const store = memoryStore();
  const snapshot = { fetchedAt: '2026-01-01T00:00:00.000Z', records: [record(9)] };
  await store.edit(() => ({ version: 1, revision: randomUUID(), sourceUserId: '1', snapshot, job: null }));
  const source: HpoiPurchaseSource = {
    async verifyOwner() {},
    async discover() {
      return { references: [], pages: 0 };
    },
    async read() {
      throw new Error('Unexpected read');
    },
  };
  const started = await startHpoiPurchaseJob(store, source, '1');
  assert.ok(started?.job);
  const restarted = await startHpoiPurchaseJob(store, source, '1', started.job.id);
  assert.notEqual(restarted?.job?.id, started.job.id);
  assert.deepEqual(restarted?.snapshot, snapshot);
  await assert.rejects(startHpoiPurchaseJob(store, source, '1', started.job.id), HfS3ConflictError);
});

it('a second window cannot duplicate in-flight reads and stale job IDs cannot advance another refresh', async () => {
  const store = memoryStore();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered = () => {};
  const held = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const source: HpoiPurchaseSource = {
    async verifyOwner() {},
    async discover() {
      entered();
      await gate;
      return { references: [], pages: 0 };
    },
    async read() {
      throw new Error('Unexpected detail request');
    },
  };
  const started = await startHpoiPurchaseJob(store, source, '1');
  assert.ok(started?.job);
  const id = started.job.id;
  const advancing = advanceHpoiPurchaseJob(store, source, id);
  await held;
  await assert.rejects(advanceHpoiPurchaseJob(store, source, id), HfS3ConflictError);
  await assert.rejects(startHpoiPurchaseJob(store, source, '1', id), HfS3ConflictError);
  release();
  assert.equal((await advancing)?.job, null);
  await startHpoiPurchaseJob(store, source, '1');
  await assert.rejects(advanceHpoiPurchaseJob(store, source, id), HfS3ConflictError);
});

it('refuses unverified owners before storage writes and never publishes malformed purchase identities', async () => {
  const store = memoryStore();
  const source: HpoiPurchaseSource = {
    async verifyOwner() {
      throw new Error('Wrong Hpoi account');
    },
    async discover() {
      return { references: [reference(1)], pages: 1 };
    },
    async read() {
      return record(2);
    },
  };
  await assert.rejects(startHpoiPurchaseJob(store, source, '1'), /Wrong Hpoi account/);
  assert.equal(await store.read(), null);
  source.verifyOwner = async () => {};
  const started = await startHpoiPurchaseJob(store, source, '1');
  assert.ok(started?.job);
  const failed = await advanceHpoiPurchaseJob(store, source, started.job.id);
  assert.equal(failed?.snapshot, null);
  assert.equal(failed?.job?.error, 'upstream');
  assert.equal(failed?.job?.records.length, 0);
});

it('does not merge distinct collection records solely because they refer to the same figure', async () => {
  const store = memoryStore();
  const a = record(1),
    b = { ...record(2), figureId: a.figureId };
  const saved = await store.edit(() => ({
    version: 1,
    revision: randomUUID(),
    sourceUserId: '1',
    snapshot: { fetchedAt: new Date().toISOString(), records: [a, b] },
    job: null,
  }));
  assert.equal(saved?.snapshot?.records.length, 2);
});
