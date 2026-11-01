// FLEET-2 run-at-commit: github_playground_run through every write door (real signed native Git
// worker, fake GitHub validated against the vendored schema), plus the full open -> provision ->
// run -> dispose flow with only the runtime-side collaborators replaced.
import {afterEach, expect, it} from 'vitest';
import {runWriteContract, makeWorld, parse, doorsFor} from '../../test/helpers/write-contract.js';
import {prepareNativeWorld} from '../../test/helpers/native-git-world.js';
import * as playground from '../../src/tools/playground.js';
import {defaultRunDeps, runLeaseMs, presentRun} from '../../src/playground/run.js';
import {nativeConnection} from '../../src/native-git/client.js';

const cleanups = []; afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
const name = 'github_playground_run';
const definition = {tool: playground.tools.find(t => t.name === name), handler: playground.handlers[name]};
const arrange = (gh, outcome) => { gh.nativeOutcome = outcome; gh.when('GET /repos/{owner}/{repo}').reply(200, {full_name: 'example-org/hello', default_branch: 'main'}); };
const args = {owner: 'example-org', repo: 'hello', ref: 'main', argv: ['npm', 'test'], requestKey: 'run-one'};

// No runtime host exists in this world: the run opens the real workspace at the ref, finds no
// computer or pool, deletes the workspace again and reports that nothing ran.
runWriteContract({label: name, definition, args, arrange, needsConfirm: true, profile: 'full', expectedWrites: 0,
  prepare: async w => { cleanups.push(await prepareNativeWorld(w)); await w.nativeReady(); }});

async function world() {
  const w = await makeWorld({profile: 'full', mode: 'production', gates: []}); arrange(w.gh, 'ok');
  cleanups.push(await prepareNativeWorld(w)); await w.nativeReady(); return w;
}
// Runtime-side fakes: an allocation that attaches on the first ensure and a command engine.
function runtimeFakes({status = {state: 'completed', exitCode: 0, signal: null, reason: null}, attachAfter = 1, log = 'all 12 tests passed\n'} = {}) {
  const calls = {enqueue: [], start: [], dispose: 0, ensure: 0}; let alloc = null;
  const deps = {...defaultRunDeps, sleep: async () => {},
    enqueueAllocation: async (_c, _r, o) => { calls.enqueue.push(o); alloc ??= {phase: 'requested', size: o.size, runtimeImage: {variant: 'slim', reason: 'fixture'}}; return alloc; },
    allocationRecord: async () => alloc,
    ensureAllocation: async () => { calls.ensure++; if (calls.ensure >= attachAfter) alloc = {...alloc, phase: 'allocated'}; return alloc; },
    attachRepository: async () => { alloc = {...alloc, phase: 'attached'}; return alloc; },
    playgroundRecord: async () => ({allocation: {binding: 'b'.repeat(64)}}),
    availability: async () => ({execution_available: true}),
    callPlayground: async (_c, _r, action, o) => {
      if (action === 'start') { calls.start.push(o); return {id: o.id, state: 'running'}; }
      if (action === 'status') return {id: o.id, ...status};
      if (action === 'logs') return {id: o.id, base64: Buffer.from(log).toString('base64'), totalBytes: log.length, logHash: 'c'.repeat(64)};
      throw new Error('unexpected ' + action);
    },
    disposeAllocation: async () => { calls.dispose++; alloc = null; return {disposed: true}; }};
  return {deps, calls};
}

it('runs one command at a branch on the smallest fitting size, returns exit code and log tail, and cleans everything up', async () => {
  const w = await world(), {deps, calls} = runtimeFakes();
  const tool = playground.runToolDefinition(deps, {pollMs: 1});
  for (const door of doorsFor(tool)) {
    const out = parse(await door.call(w, {...args, requestKey: 'full-' + door.name}));
    expect(out).toMatchObject({status: 'applied', confirmed: true, result: {phase: 'done', finished: true, runtime_size: 'small', command_succeeded: true, exit_code: 0, log_tail: 'all 12 tests passed\n', cleaned_up: true, untrusted: true}});
    expect(out.result.size_reason).toMatch(/No browser or database/);
    expect(out.result.head).toMatch(/^[a-f0-9]{40}$/);
    const job = await w.db.getJob(out.result.workspace_id, nativeConnection(w.ctx));
    expect(job).toMatchObject({state: 'ready', detail: 'Native workspace disposed.'});
    expect(w.nativeRequests).toContain('close');
  }
  expect(calls.start).toHaveLength(3); // one per door, never twice per intent
  expect(calls.dispose).toBe(3);
  expect(calls.enqueue.every(o => o.size === 'small' && Array.isArray(o.signals) && o.signals.length === 0)).toBe(true);
  expect(w.gh.invalid).toEqual([]);
});

it('checks out an exact commit SHA and refuses an unreachable one without running anything', async () => {
  const w = await world(), {deps, calls} = runtimeFakes();
  const tool = playground.runToolDefinition(deps, {pollMs: 1});
  const first = parse(await tool.handler({...args, requestKey: 'branch'}, w.ctx));
  const sha = first.result.head;
  const pinned = parse(await tool.handler({...args, ref: sha, requestKey: 'sha'}, w.ctx));
  expect(pinned.result).toMatchObject({phase: 'done', head: sha, command_succeeded: true});
  const missing = parse(await tool.handler({...args, ref: 'f'.repeat(40), requestKey: 'missing'}, w.ctx));
  expect(missing.result).toMatchObject({phase: 'done', outcome: 'ref_unavailable', command_started: false, cleaned_up: true});
  expect(calls.start).toHaveLength(2);
});

it('is resumable: a call that runs out of budget returns its phase and the same requestKey continues without a second start', async () => {
  const w = await world(), {deps, calls} = runtimeFakes({attachAfter: 3});
  const tool = playground.runToolDefinition(deps, {budgetMs: 0, pollMs: 1});
  const first = parse(await tool.handler({...args, requestKey: 'slow'}, w.ctx));
  expect(first).toMatchObject({status: 'applied', result: {finished: false, phase: 'provisioning'}});
  expect(first.result.next).toMatch(/same arguments and requestKey/);
  let out = first;
  for (let i = 0; i < 6 && !out.result.finished; i++) out = parse(await tool.handler({...args, requestKey: 'slow'}, w.ctx));
  expect(out).toMatchObject({status: 'replayed', replay_state: 'current', result: {phase: 'done', command_succeeded: true}});
  expect(calls.start).toHaveLength(1);
  // A finished run is only read again.
  const again = parse(await tool.handler({...args, requestKey: 'slow'}, w.ctx));
  expect(again.result.phase).toBe('done'); expect(calls.start).toHaveLength(1);
});

it('reports an out-of-memory kill with the next size up, and the lease covers the whole command', async () => {
  const w = await world(), {deps} = runtimeFakes({status: {state: 'failed', exitCode: null, signal: 'SIGKILL', reason: 'out_of_memory'}});
  const tool = playground.runToolDefinition(deps, {pollMs: 1});
  const out = parse(await tool.handler({...args, size: 'small', requestKey: 'oom'}, w.ctx));
  expect(out.result).toMatchObject({phase: 'done', command_succeeded: false, reason: 'out_of_memory', outcome: 'failed', upsize: {next_size: 'medium'}});
  expect(out.result.upsize.hint).toMatch(/size medium/);
  expect(runLeaseMs(3600000)).toBe(3600000 + 1800000); expect(runLeaseMs(1)).toBe(1800001); expect(runLeaseMs(14400000)).toBe(16200000);
});

it('refuses an invalid ref and a pass without Git access before anything is cloned', async () => {
  const w = await world();
  const bad = parse(await definition.handler({...args, ref: 'main..evil', requestKey: 'bad-ref'}, w.ctx));
  expect(bad).toMatchObject({status: 'refused_by_guard', reason_code: 'invalid_ref', no_change_sent: true});
  const pass = {...w.ctx, connection: {...w.ctx.connection, pass: true, allow_writes: true, areas: ['playground'], repos: null}};
  const refused = parse(await definition.handler({...args, requestKey: 'pass'}, pass));
  expect(refused).toMatchObject({status: 'refused_by_guard', no_change_sent: true});
  expect(w.nativeRequests ?? []).not.toContain('open');
});

it('presents a waiting run plainly', () => {
  expect(presentRun({phase: 'starting', workspace_id: 'job_0123456789abcdef', owner: 'o', repo: 'r', ref: 'main', size: 'small'})).toMatchObject({finished: false, command_started: false, runtime_size: 'small'});
  expect(presentRun(null)).toBeNull();
});
