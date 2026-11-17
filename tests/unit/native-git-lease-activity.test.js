// PG-STUCK-1: which calls count as workspace activity (extend the idle lease), and closing a
// runtime-attached workspace in one call or by repeating the same call.
import {it, expect, describe, afterEach} from 'vitest';
import {makeWorld, parse} from '../../test/helpers/write-contract.js';
import {prepareNativeWorld} from '../../test/helpers/native-git-world.js';
import {preparePlaygroundWorld} from '../../test/helpers/playground-world.js';
import {nativeConnection} from '../../src/native-git/client.js';
import {playgroundRecord, playgroundBinding} from '../../src/playground/client.js';
import {allocationRecord, allocationKey} from '../../src/playground/allocations.js';
import * as native from '../../src/tools/native-git.js';
import * as playground from '../../src/tools/playground.js';

const ID = 'job_0123456789abcdef', MIN = 60000;
const cleanups = []; afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
async function nativeWorld() {
  const w = await makeWorld({profile: 'full', mode: 'production', gates: []});
  w.gh.nativeOutcome = 'ok'; w.gh.when('GET /repos/{owner}/{repo}').reply(200, {full_name: 'example-org/hello'});
  cleanups.push(await prepareNativeWorld(w, {existing: true})); await w.nativeReady();
  return w;
}
const expiry = async w => (await w.db.getJob(ID, nativeConnection(w.ctx))).expires_at.getTime();
const view = r => r?.content || r?.structuredContent ? parse(r) : r;
// The fixture worker runs its real resource monitor (no limits overridden). On a loaded CI runner it can answer a
// retryable "busy, no operation was started" refusal (event-loop delay over its limit). Nothing ran, so the same call
// is simply repeated after a short pause, as an agent would; every other error and every result is unchanged.
const busy = e => e?.safeCode === 'native_busy' && e?.nativeNoOperationStarted === true && e?.safeRetryable === true;
const call = async (w, name, args, extra = {}) => {
  for (let attempt = 1; ; attempt++) {
    try { return await (native.handlers[name] ?? playground.handlers[name])(args, {...w.ctx, ...extra}); }
    catch (e) { if (!busy(e) || attempt >= 20) throw e; await new Promise(t => setTimeout(t, 250)); }
  }
};

describe('only real work extends the idle lease', () => {
  it('status reads and failed preflights do not; Git reads and Git operations do', async () => {
    const w = await nativeWorld();
    w.advanceClock(10 * MIN); await call(w, 'github_git_workspace_read', {workspace_id: ID, operation: 'refs'});
    const renewed = await expiry(w); expect(renewed).toBe(w.ctx.now() + 240 * MIN);
    // A status check, even repeated, is not activity.
    w.advanceClock(10 * MIN);
    for (let i = 0; i < 3; i++) expect(view(await call(w, 'github_git_workspace_read', {workspace_id: ID, operation: 'status'}))).toMatchObject({state: 'ready', head: expect.stringMatching(/^[a-f0-9]{40}$/)});
    expect(await expiry(w)).toBe(renewed);
    // A refused write (bad arguments) is not activity either.
    parse(await call(w, 'github_git_workspace_run', {workspace_id: ID, operation: 'branch_create', expectedGeneration: 0, options: {}, requestKey: 'bad'}));
    expect(await expiry(w)).toBe(renewed);
    // A real Git operation is.
    w.advanceClock(5 * MIN);
    expect(parse(await call(w, 'github_git_workspace_run', {workspace_id: ID, operation: 'branch_create', expectedGeneration: 0, options: {name: 'activity'}, requestKey: 'real'})).status).toBe('applied');
    expect(await expiry(w)).toBe(w.ctx.now() + 240 * MIN);
  });
  it('a Playground status/log read through the runtime is activity', async () => {
    const w = await makeWorld({profile: 'full', mode: 'production', gates: []});
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, {full_name: 'example-org/hello'});
    cleanups.push(await preparePlaygroundWorld(w));
    w.advanceClock(20 * MIN);
    await call(w, 'github_playground_read', {owner: 'example-org', repo: 'hello', workspace_id: ID, operation: 'status', execution_id: 'a'.repeat(64)});
    expect(await expiry(w)).toBe(w.ctx.now() + 240 * MIN);
  });
});

describe('closing a workspace', () => {
  it('an unconfirmed close is finished by the same call again (same requestKey), not a new key', async () => {
    const w = await nativeWorld();
    w.gh.nativeOutcome = 'mismatch'; // the worker does not close it on the first try
    const first = parse(await call(w, 'github_git_workspace_close', {workspace_id: ID, requestKey: 'close-once'}));
    expect(first).toMatchObject({status: 'unconfirmed', done: false});
    w.gh.nativeOutcome = 'ok';
    const again = parse(await call(w, 'github_git_workspace_close', {workspace_id: ID, requestKey: 'close-once'}));
    expect(again).toMatchObject({status: 'replayed', done: true, confirmed: true, replay_state: 'current', result: {disposed: true}});
    expect((await w.db.getJob(ID, nativeConnection(w.ctx))).state).toBe('ready');
    // And once more: nothing is sent again.
    const closes = w.nativeRequests.filter(a => a === 'close').length;
    expect(parse(await call(w, 'github_git_workspace_close', {workspace_id: ID, requestKey: 'close-once'}))).toMatchObject({status: 'replayed', done: true});
    expect(w.nativeRequests.filter(a => a === 'close')).toHaveLength(closes);
  });

  // DOKPLOY-RETIRE-1 (2026-11-17): a workspace whose runtime was on the retired shared pool. Its row is closed in
  // place (the pool's resources were removed on that server by its owner), so the close finishes in one call.
  it('a workspace whose runtime was on the retired pool closes in one call', async () => {
    const w = await makeWorld({profile: 'full', mode: 'production', gates: []});
    w.gh.nativeOutcome = 'ok'; w.gh.when('GET /repos/{owner}/{repo}').reply(200, {full_name: 'example-org/hello'});
    cleanups.push(await prepareNativeWorld(w, {existing: true})); await w.nativeReady();
    const record = await playgroundRecord(w.ctx, {owner: 'example-org', repo: 'hello', workspace_id: ID}, {allowUnattached: true});
    const binding = playgroundBinding(record);
    expect(await w.ctx.db.compareAndSetSetting(allocationKey(binding), 0, {revision: 1, kind: 'playground-allocation', pool: 'default',
      providerOrigin: 'https://old-pool.example.test', binding, connection: nativeConnection(w.ctx), workspace: ID, owner: 'example-org', repo: 'hello',
      phase: 'allocated', composeId: 'compose-1', plan: {name: 'ras-pg-x'}})).toBeTruthy();
    const out = parse(await call(w, 'github_git_workspace_close', {workspace_id: ID, requestKey: 'close-retired-pool'}));
    expect(out).toMatchObject({status: 'applied', done: true, result: {disposed: true}});
    expect(await allocationRecord(w.ctx, record)).toMatchObject({phase: 'disposed', retiredPool: true});
    expect((await w.db.getJob(ID, nativeConnection(w.ctx))).detail).toBe('Native workspace disposed.');
  });
});
