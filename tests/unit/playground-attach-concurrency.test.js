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
    if (action === 'attachment_export' && options.mode === 'read') return {digest: 'd'.repeat(64), offset: options.offset, nextOffset: options.offset + 4, base64: Buffer.from('abcd').toString('base64')};
    if (action === 'attachment_import' && options.mode === 'begin') return {transferId: 't'.repeat(64), bytes: 64, digest: 'd'.repeat(64), offset: 0};
    if (action === 'attachment_import' && options.mode === 'append') {
      if (behaviour.appendError) { const e = new Error(behaviour.appendError); e.status = 400; throw e; }
      return {offset: options.offset + 4};
    }
    throw new Error('unexpected ' + action + ' ' + options.mode);
  }
}));
const {attachRepository} = await import('../../src/playground/attachment.js');

const binding = 'b'.repeat(64);
function world({casFails = false} = {}) {
  const transfer = {transferId: 't'.repeat(64), bytes: 64, digest: 'd'.repeat(64), generation: 1, offset: 0};
  let row = {revision: 3, binding, composeId: 'c1', phase: 'attaching', plan: {origin: 'https://ras-pg.example.test/'}, transfer};
  const db = {
    getSetting: async () => row,
    compareAndSetSetting: async (_key, revision, next) => { if (casFails || revision !== row.revision) return null; row = next; return next; },
    playgroundScope: null
  };
  const record = {binding: {authority: 'a', connection: 'c', owner: 'o', repo: 'r'}, worker: 'git_' + '1'.repeat(32), job: {idleTimeoutMs: 600000}, allocation: {binding}};
  return {ctx: {db, env: {NATIVE_GIT_WORKER_KEY: 'FAKE-local-native-contract-worker-key'}}, record};
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
});
