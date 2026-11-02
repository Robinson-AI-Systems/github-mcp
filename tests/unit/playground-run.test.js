// FLEET-2 run-at-commit: github_playground_run through every write door (real signed native Git
// worker, fake GitHub validated against the vendored schema), plus the full open -> provision ->
// run -> dispose flow with only the runtime-side collaborators replaced.
import {afterEach, expect, it} from 'vitest';
import {runWriteContract, makeWorld, parse, doorsFor} from '../../test/helpers/write-contract.js';
import {prepareNativeWorld} from '../../test/helpers/native-git-world.js';
import * as playground from '../../src/tools/playground.js';
import {defaultRunDeps, runLeaseMs, presentRun, runEssentials, runIntent, runSettingKey} from '../../src/playground/run.js';
import {deduplicateLargeEnvelope} from '../../src/core/result-envelope.js';
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
function runtimeFakes({status = {state: 'completed', exitCode: 0, signal: null, reason: null}, attachAfter = 1, runningPolls = 0, log = 'all 12 tests passed\n'} = {}) {
  const calls = {enqueue: [], start: [], dispose: 0, ensure: 0, status: 0}; let alloc = null;
  const deps = {...defaultRunDeps, sleep: async () => {},
    enqueueAllocation: async (_c, _r, o) => { calls.enqueue.push(o); alloc ??= {phase: 'requested', size: o.size, runtimeImage: {variant: 'slim', reason: 'fixture'}}; return alloc; },
    allocationRecord: async () => alloc,
    ensureAllocation: async () => { calls.ensure++; if (calls.ensure >= attachAfter) alloc = {...alloc, phase: 'allocated'}; return alloc; },
    attachRepository: async () => { alloc = {...alloc, phase: 'attached'}; return alloc; },
    playgroundRecord: async () => ({allocation: {binding: 'b'.repeat(64)}}),
    availability: async () => ({execution_available: true}),
    callPlayground: async (_c, _r, action, o) => {
      if (action === 'start') { calls.start.push(o); return {id: o.id, state: 'running'}; }
      if (action === 'status') { calls.status++; return calls.status <= runningPolls ? {id: o.id, state: 'running'} : {id: o.id, ...status}; }
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

// Live bug 2026-11-01 (release 9e9946d0): repeat calls must visibly advance the run, never start
// the command twice, and show the essentials even when a compact client drops `result`.
it('drives a run to completion through repeated calls with the same requestKey on every door, starting the command once per intent', async () => {
  const w = await world(), {deps, calls} = runtimeFakes({attachAfter: 3, runningPolls: 2});
  const tool = playground.runToolDefinition(deps, {budgetMs: 0, pollMs: 1});
  for (const door of doorsFor(tool)) {
    const a = {...args, requestKey: 'resume-' + door.name};
    let raw = await door.call(w, a), out = parse(raw);
    expect(out).toMatchObject({status: 'applied', result: {finished: false}});
    const phases = [out.result.phase];
    for (let i = 0; i < 20 && !out.result.finished; i++) { raw = await door.call(w, a); out = parse(raw); phases.push(out.result.phase); }
    expect(out).toMatchObject({status: 'replayed', replay_state: 'current', confirmed: true,
      result: {phase: 'done', finished: true, command_succeeded: true, exit_code: 0, cleaned_up: true},
      progress: {phase: 'done', finished: true, execution_state: 'finished', exit_code: 0, outcome: 'succeeded'}});
    // Every phase of the machine was passed through, in order, across separate calls.
    expect([...new Set(phases)]).toEqual(['provisioning', 'starting', 'running', 'disposing', 'done']);
    expect(out.progress.log_end).toBe('all 12 tests passed\n');
    // A waiting call records that it is alive and what it waits for.
    const stored = await w.db.getSetting(runSettingKey(runIntent(w.ctx, a)));
    expect(stored).toMatchObject({phase: 'done', advance: null}); expect(Number.isFinite(stored.lastAdvancedAt)).toBe(true);
  }
  expect(calls.start).toHaveLength(3); // one per door (each its own intent), never twice
  expect(calls.dispose).toBe(3);
});

it('never starts the command twice when the same requestKey is called concurrently', async () => {
  const w = await world(), {deps, calls} = runtimeFakes({attachAfter: 2, runningPolls: 3});
  const tool = playground.runToolDefinition(deps, {budgetMs: 0, pollMs: 1});
  const a = {...args, requestKey: 'concurrent'};
  const first = parse(await tool.handler(a, w.ctx));
  expect(first.result.finished).toBe(false);
  let outs = [];
  for (let round = 0; round < 12 && !outs.some(o => o.result?.finished); round++)
    outs = (await Promise.all(Array.from({length: 5}, () => tool.handler(a, w.ctx)))).map(parse);
  expect(outs.some(o => o.result?.phase === 'done')).toBe(true);
  expect(outs.every(o => o.status === 'replayed')).toBe(true);
  expect(calls.start).toHaveLength(1);
  expect(calls.dispose).toBe(1);
});

it('a call holding the advance lease makes every other call only read', async () => {
  const w = await world(), {deps, calls} = runtimeFakes({attachAfter: 1});
  const tool = playground.runToolDefinition(deps, {budgetMs: 0, pollMs: 1});
  const a = {...args, requestKey: 'leased'};
  parse(await tool.handler(a, w.ctx));
  const key = runSettingKey(runIntent(w.ctx, a)), held = await w.db.getSetting(key);
  await w.db.compareAndSetSetting(key, held.revision, {...held, advance: {lease: 'other', until: (w.ctx.now ?? Date.now)() + 60000}, revision: held.revision + 1});
  const read = parse(await tool.handler(a, w.ctx));
  expect(read).toMatchObject({status: 'replayed', result: {phase: held.phase}});
  expect(calls.start).toHaveLength(0);
  // An expired lease (a call cut off by the function time limit) is taken over by the next call.
  const now = await w.db.getSetting(key);
  await w.db.compareAndSetSetting(key, now.revision, {...now, advance: {lease: 'other', until: (w.ctx.now ?? Date.now)() - 1}, revision: now.revision + 1});
  let out = read; for (let i = 0; i < 10 && !out.result.finished; i++) out = parse(await tool.handler(a, w.ctx));
  expect(out.result).toMatchObject({phase: 'done', command_succeeded: true}); expect(calls.start).toHaveLength(1);
});

it('continues a run whose first call was cut off before its outcome was journalled, and completes the journal row', async () => {
  const w = await world(), {deps, calls} = runtimeFakes({attachAfter: 2});
  const tool = playground.runToolDefinition(deps, {budgetMs: 0, pollMs: 1});
  const a = {...args, requestKey: 'cut-off'};
  // The serverless call is stopped after apply: finishChange never runs, the row stays unrecorded.
  const cut = {...w.ctx, db: {...w.db, finishChange: async () => true}};
  await tool.handler(a, cut);
  const pending = await w.db.claimChange({tool: name, summary: 'x', requestKey: 'rmcp_playground_run_' + runIntent(w.ctx, a) + '_0'});
  expect(pending).toMatchObject({claimed: false, existing: {confirmed: null}});
  let out = parse(await tool.handler(a, w.ctx));
  expect(out).toMatchObject({status: 'replayed', replay_state: 'current', confirmed: true});
  for (let i = 0; i < 10 && !out.result.finished; i++) out = parse(await tool.handler(a, w.ctx));
  expect(out.result).toMatchObject({phase: 'done', command_succeeded: true}); expect(calls.start).toHaveLength(1);
  const healed = await w.db.claimChange({tool: name, summary: 'x', requestKey: 'rmcp_playground_run_' + runIntent(w.ctx, a) + '_0'});
  expect(healed.existing.confirmed).toBe(true);
});

it('a waiting run records what it waits for and when it last advanced, instead of looking frozen', async () => {
  const w = await world(), {deps} = runtimeFakes({attachAfter: 99});
  const base = w.ctx.now ?? Date.now; let skew = 0; const ctx = {...w.ctx, now: () => base() + skew};
  const tool = playground.runToolDefinition(deps, {budgetMs: 0, pollMs: 1});
  const a = {...args, requestKey: 'waiting'};
  await tool.handler(a, ctx);
  const one = parse(await tool.handler(a, ctx));
  skew += 5000; const two = parse(await tool.handler(a, ctx));
  expect(one.result).toMatchObject({phase: 'provisioning', allocation_phase: 'requested'}); expect(one.result.waiting_on).toMatch(/runtime is requested/);
  expect(Date.parse(two.result.last_advanced_at)).toBeGreaterThanOrEqual(Date.parse(one.result.last_advanced_at) + 5000);
  expect(two.progress).toMatchObject({phase: 'provisioning', finished: false, execution_state: 'not_started'});
  expect(two.progress.waiting_on).toMatch(/requested/);
});

it('a compact client still sees the run essentials when the large result is deduplicated', async () => {
  const w = await world(), {deps} = runtimeFakes({log: 'x'.repeat(5000) + 'TAIL'});
  const tool = playground.runToolDefinition(deps, {pollMs: 1});
  const dispatchDoor = doorsFor(tool).find(d => d.name === 'dispatch');
  const raw = await dispatchDoor.call(w, {...args, argv: ['sh', '-c', 'echo ' + 'y'.repeat(300)], requestKey: 'compact'});
  const compact = deduplicateLargeEnvelope(raw, {budget: 600}); // a result past the budget
  expect(compact.structuredContent.omitted_fields).toContain('result');
  expect(compact.structuredContent.progress).toMatchObject({phase: 'done', finished: true, exit_code: 0, outcome: 'succeeded', execution_state: 'finished'});
  expect(compact.structuredContent.progress.log_end.endsWith('TAIL')).toBe(true);
  expect(compact.structuredContent.progress.next).toMatch(/Finished/);
  // Multibyte logs never push the digest past the write layer's bound.
  const big = runEssentials(presentRun({phase: 'done', workspace_id: 'job_0123456789abcdef', owner: 'o', repo: 'r', ref: 'main', execution_id: 'e', execution: {state: 'completed', exitCode: 1}, log_tail: '\u{1F600}'.repeat(400), lastError: 'z'.repeat(400), waitingOn: 'w'.repeat(400)}));
  expect(Buffer.byteLength(JSON.stringify(big))).toBeLessThanOrEqual(1200);
});

// PG-STUCK-1: a run never waits on a runtime that failed to start; it is removed and replaced,
// and after repeated failures the run ends plainly with nothing run.
it('replaces a runtime whose deployment failed instead of waiting on it, then runs the command', async () => {
  const w = await world(), {deps, calls} = runtimeFakes({attachAfter: 1});
  let alloc = null, recovered = 0, ensures = 0;
  Object.assign(deps, {
    enqueueAllocation: async (_c, _r, o) => { calls.enqueue.push(o); alloc ??= {phase: 'deploying', size: o.size, cleanupRequested: true, runtimeOnly: true, cleanupReason: 'runtime_failed_to_start'}; return alloc; },
    allocationRecord: async () => alloc,
    recoverAllocation: async () => { recovered++; alloc = {...alloc, phase: 'disposed'}; return {stored: alloc, reason: 'runtime_failed_to_start', pending: false}; },
    ensureAllocation: async () => { ensures++; alloc = {phase: 'allocated', size: alloc.size}; return alloc; },
    attachRepository: async () => { alloc = {...alloc, phase: 'attached'}; return alloc; }
  });
  const tool = playground.runToolDefinition(deps, {pollMs: 1});
  const out = parse(await tool.handler({...args, requestKey: 'replaced'}, w.ctx));
  expect(out.result).toMatchObject({phase: 'done', command_succeeded: true});
  expect(recovered).toBe(1); expect(ensures).toBe(1); expect(calls.start).toHaveLength(1);
});
it('ends the run plainly when the runtime keeps failing to start', async () => {
  const w = await world(), {deps, calls} = runtimeFakes();
  Object.assign(deps, {ensureAllocation: async () => { throw Object.assign(new TypeError('This workspace\'s runtime failed to start 3 times in a row, so no new one is started automatically.'), {safeMessage: true, safeCode: 'playground_runtime_failed'}); }});
  const tool = playground.runToolDefinition(deps, {pollMs: 1});
  const out = parse(await tool.handler({...args, requestKey: 'keeps-failing'}, w.ctx));
  expect(out.result).toMatchObject({phase: 'done', outcome: 'runtime_failed_to_start', command_started: false, cleaned_up: true});
  expect(out.result.outcome_reason).toMatch(/failed to start 3 times/);
  expect(calls.start).toHaveLength(0);
});
