import {createHash} from 'node:crypto';
import {describe, expect, it, vi, beforeEach} from 'vitest';

// The native worker is replaced by a scripted fake so the control-plane attach loop
// can be driven into the two races seen live on 2026-11-01.
const calls = [];
let behaviour = {};
vi.mock('../../src/native-git/client.js', () => ({
  callNativeWorker: async (_ctx, request) => {
    calls.push(request);
    const {action, options = {}} = request;
    if (action === 'capabilities') return {repository_attachment: 'sealed-mounted-v1'};
    // Mirrors the worker: a non-renewing inspect without includeRepository returns metadata only.
    if (action === 'inspect') return request.renewLease === false && !options.includeRepository ? {generation: 2} : {generation: 2, head: 'a'.repeat(40), status: ''};
    if (action === 'attachment_export' && options.mode === 'release') { behaviour.released = (behaviour.released ?? 0) + 1; return {released: true}; }
    if (action === 'attachment_export' && options.mode === 'prepare') return {transferId: options.transferId, generation: 2, bytes: 64, digest: 'd'.repeat(64)};
    if (action === 'attachment_export' && options.mode === 'read') return {digest: 'd'.repeat(64), offset: options.offset, nextOffset: options.offset + 4, base64: Buffer.from('abcd').toString('base64')};
    if (action === 'attachment_import' && options.mode === 'begin') { if (behaviour.beginError) { const e = new Error(behaviour.beginError); e.status = 400; throw e; } return {transferId: 't'.repeat(64), bytes: 64, digest: 'd'.repeat(64), offset: 0}; }
    if (action === 'attachment_import' && options.mode === 'append') {
      if (behaviour.appendError) { const e = new Error(behaviour.appendError); e.status = 400; throw e; }
      return {offset: options.offset + 4};
    }
    throw new Error('unexpected ' + action + ' ' + options.mode);
  }
}));
const {attachRepository} = await import('../../src/playground/attachment.js');

const binding = 'b'.repeat(64);
function world({casFails = false, fresh = false, headless = false} = {}) {
  // A headless (stuck) transfer carries the same ID a naive re-prepare would compute (binding + generation 2).
  const staleId = createHash('sha256').update(JSON.stringify([binding, 2])).digest('hex');
  const transfer = {transferId: headless ? staleId : 't'.repeat(64), bytes: 64, digest: 'd'.repeat(64), generation: headless ? 2 : 1, offset: 0, ...(headless ? {} : {sourceHead: 'a'.repeat(40), sourceStatus: ''})};
  let row = {revision: 3, binding, composeId: 'c1', phase: fresh ? 'allocated' : 'attaching', plan: {origin: 'https://ras-pg.example.test/'}, ...(fresh ? {} : {transfer})};
  const db = {
    getSetting: async () => row,
    compareAndSetSetting: async (_key, revision, next) => { if (casFails || revision !== row.revision) return null; row = next; return next; },
    playgroundScope: null
  };
  const record = {binding: {authority: 'a', connection: 'c', owner: 'o', repo: 'r'}, worker: 'git_' + '1'.repeat(32), job: {idleTimeoutMs: 600000}, allocation: {binding}};
  return {ctx: {db, env: {NATIVE_GIT_WORKER_KEY: 'FAKE-local-native-contract-worker-key'}}, record, row: () => row};
}
vi.mock('../../src/playground/client.js', async (orig) => ({...(await orig()), playgroundBinding: () => binding}));
vi.mock('../../src/playground/index.js', () => ({indexAllocation: async () => {}}));
beforeEach(() => { calls.length = 0; behaviour = {}; });

describe('attach while another attach of the same workspace is running', () => {
  it('turns the receiver refusing a stale window into a plain, retryable "already in progress"', async () => {
    behaviour.appendError = 'Native Git worker returned HTTP 400: Attachment window differs; inspect its original offset.';
    const {ctx, record} = world();
    const error = await attachRepository(ctx, record, {budgetMs: 1000}).catch(e => e);
    expect(error.message).toMatch(/already in progress/);
    expect(error.message).toMatch(/Nothing was lost/);
    expect(error.safeRetryable).toBe(true);
  });
  it('says the same when the other attach saved its progress first', async () => {
    const {ctx, record} = world({casFails: true});
    const error = await attachRepository(ctx, record, {budgetMs: 0}).catch(e => e);
    expect(error.message).toMatch(/already in progress/);
  });
  it('still reports any other receiver failure as itself', async () => {
    behaviour.appendError = 'disk full';
    const {ctx, record} = world();
    await expect(attachRepository(ctx, record, {budgetMs: 1000})).rejects.toThrow('disk full');
  });
  it('never renews the workspace lease from attach (the cleanup sweep retries attaches)', async () => {
    const {ctx, record} = world({fresh: true});
    await attachRepository(ctx, record, {budgetMs: 0}).catch(() => {});
    const workerCalls = calls.filter(c => c.workspace_id || c.action === 'inspect');
    expect(workerCalls.some(c => c.action === 'inspect')).toBe(true);
    for (const c of workerCalls) expect([c.action, c.renewLease]).toEqual([c.action, false]);
  });
  it('records the source head and status when preparing a transfer (needed to verify the attachment)', async () => {
    const {ctx, record, row} = world({fresh: true});
    await attachRepository(ctx, record, {budgetMs: 0}).catch(() => {});
    expect(row().transfer).toMatchObject({sourceHead: 'a'.repeat(40), sourceStatus: ''});
    const inspect = calls.find(c => c.action === 'inspect');
    expect(inspect).toMatchObject({renewLease: false, options: {includeRepository: true}});
  });
  it('heals a transfer saved without its source head: releases the lock and prepares a fresh one', async () => {
    const {ctx, record, row} = world({headless: true});
    await attachRepository(ctx, record, {budgetMs: 0}).catch(() => {});
    expect(behaviour.released).toBe(1);
    expect(row().transfer.sourceHead).toBe('a'.repeat(40));
  });
  it('gives a healed transfer a new ID so the runtime never mixes it with the stale partial import', async () => {
    const {ctx, record, row} = world({headless: true});
    const staleId = row().transfer.transferId;
    await attachRepository(ctx, record, {budgetMs: 0}).catch(() => {});
    expect(row().transferAttempt).toBe(1);
    expect(row().transfer.transferId).not.toBe(staleId);
    const prepare = calls.find(c => c.action === 'attachment_export' && c.options?.mode === 'prepare');
    expect(prepare.options.transferId).toBe(row().transfer.transferId);
  });
  it('starts a fresh attempt when the runtime holds a different partial import under the same ID', async () => {
    behaviour.beginError = 'Native Git worker returned HTTP 400: Attachment intent differs. Inspect state before a new intent.';
    const {ctx, record, row} = world();
    const error = await attachRepository(ctx, record, {budgetMs: 1000}).catch(e => e);
    expect(error.message).toMatch(/fresh transfer will start/);
    expect(error.safeRetryable).toBe(true);
    expect(row()).toMatchObject({phase: 'allocated', transfer: null, transferAttempt: 1});
    expect(behaviour.released).toBe(1);
  });
});
