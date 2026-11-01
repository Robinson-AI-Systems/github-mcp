// FLEET-2 run-at-commit: one command at one ref, then everything is disposed.
// A resumable state machine kept in one compare-and-set setting per intent:
//   opening -> provisioning -> starting -> running -> disposing -> done
// Each call advances it as far as the function budget allows (Vercel stops a call at
// 60 s) and returns the phase; a repeat call with the same requestKey continues.
// Nothing here bypasses the normal workspace, allocation or runtime checks: it calls
// the same functions the individual tools call. An abandoned run is cleaned up by the
// existing expiry sweep (workspace idle lease -> allocation and workspace disposal).
import {createHash, randomBytes} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {callNativeWorker, nativeConnection, nativeRecord} from '../native-git/client.js';
import {nativeWorkspaceId, nativeWorkerHost} from '../native-git/protocol.js';
import {TenantCapacityError} from '../tenancy/runtime-limits.js';
import {enqueueAllocation, ensureAllocation, allocationRecord, disposeAllocation} from './allocations.js';
import {attachRepository} from './attachment.js';
import {playgroundRecord, callPlayground, playgroundExecutionId, presentPlayground} from './client.js';
import {playgroundAvailability, requirePlaygroundExecution} from './availability.js';
import {repositorySignals, autoSizeFor} from './runtime-variant.js';
import {upsizeHint} from './sizing.js';

export const RUN_PHASES = Object.freeze(['opening', 'provisioning', 'starting', 'running', 'disposing', 'done']);
const SHA = /^[a-f0-9]{40}$/;
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail = (code, message) => Object.assign(new TypeError(message), {safeMessage: true, safeCode: code});
const DEFAULT_TIMEOUT = 600000, TAIL = 4096;

/** Stable identity of one run intent: same connection, repository, ref, command and size. */
export function runIntent(ctx, a) {
  if (typeof a.requestKey !== 'string' || a.requestKey.length < 1 || a.requestKey.length > 128) throw fail('playground_intent_required', 'Supply a stable requestKey for this run; repeat the same call with it to continue or read the result.');
  const owner = a.owner ?? ctx.connection.default_account;
  return hash(['robinson-playground-run/v1', nativeConnection(ctx), owner.toLowerCase(), a.repo.toLowerCase(), a.ref, a.argv, a.cwd ?? '.', a.size ?? 'auto', a.timeoutMs ?? DEFAULT_TIMEOUT, a.requestKey]);
}
export const runSettingKey = intent => 'playground_run.' + intent.slice(0, 40);
export const runRequestKey = (ctx, a) => 'rmcp_playground_run_' + runIntent(ctx, a) + '_0';
/** The workspace idle lease covers provisioning plus the whole command. */
export const runLeaseMs = timeoutMs => Math.min(86400000, Math.max(1800000, (timeoutMs ?? DEFAULT_TIMEOUT) + 1800000));

/** Real collaborators; tests replace the runtime-side ones (allocation and command transport). */
export const defaultRunDeps = Object.freeze({
  callNativeWorker, nativeRecord, enqueueAllocation, ensureAllocation, attachRepository, allocationRecord, disposeAllocation,
  playgroundRecord, callPlayground, repositorySignals,
  availability: (ctx, record) => playgroundAvailability(ctx, record, () => callPlayground(ctx, record, 'capabilities')),
  sleep: (ctx, ms) => (typeof ctx.sleep === 'function' ? ctx.sleep(ms) : pause(ms))
});

async function saver(ctx, key, state) {
  let current = state;
  return {
    get: () => current,
    async save(patch) {
      const next = await ctx.db.compareAndSetSetting(key, current.revision, {...current, ...patch, revision: current.revision + 1, updatedAt: (ctx.now ?? Date.now)()});
      if (!next) { const fresh = await ctx.db.getSetting(key); throw Object.assign(fail('playground_run_busy', 'Another call is advancing this same run; read it again in a moment.'), {fresh}); }
      current = next; return next;
    }
  };
}

/** Open the Git-only workspace for a new run (the same steps as github_git_workspace_open). */
export async function startRun(ctx, a, {deps = defaultRunDeps, requestKey} = {}) {
  const intent = runIntent(ctx, a), key = runSettingKey(intent), owner = a.owner ?? ctx.connection.default_account;
  const existing = await ctx.db.getSetting(key);
  if (existing) return existing;
  const id = 'job_' + randomBytes(8).toString('hex'), leaseMs = runLeaseMs(a.timeoutMs);
  const binding = {authority: randomBytes(16).toString('hex'), connection: nativeConnection(ctx), owner, repo: a.repo};
  const nativeKey = requestKey ?? runRequestKey(ctx, a), worker = nativeWorkspaceId(binding, nativeKey), host = nativeWorkerHost(ctx.env);
  await ctx.db.createJob({id, connection: nativeConnection(ctx), owner, repo: a.repo, kind: 'native-git-workspace', providerRef: JSON.stringify({authority: binding.authority, worker, host, idleTimeoutMs: leaseMs}), ttlMinutes: Math.ceil(leaseMs / 60000)}).catch(error => {
    if (error instanceof TenantCapacityError) throw Object.assign(new TypeError('Active workspace capacity was reached before anything was cloned. Close a finished workspace or wait for idle cleanup.'), {status: 429, safeMessage: true, safeRetryable: true, noOperationStarted: true});
    throw error;
  });
  const row = {revision: 0, kind: 'playground-run', intent, connection: nativeConnection(ctx), owner, repo: a.repo, ref: a.ref, argv: a.argv, cwd: a.cwd ?? '.', timeoutMs: a.timeoutMs ?? DEFAULT_TIMEOUT, sizeRequested: a.size ?? 'auto', workspace_id: id, phase: 'opening', createdAt: (ctx.now ?? Date.now)()};
  const saved = await ctx.db.compareAndSetSetting(key, 0, {...row, revision: 1});
  if (!saved) { await ctx.db.finishJob(id, nativeConnection(ctx), {state: 'failed', detail: 'Duplicate run intent; nothing was cloned.'}); return await ctx.db.getSetting(key); }
  try {
    await deps.callNativeWorker(ctx, {action: 'open', binding, job: {id, host, idleTimeoutMs: leaseMs}, requestKey: nativeKey, allowWrite: true, network: true, options: {...(SHA.test(a.ref) ? {} : {branch: a.ref}), ttlMs: leaseMs}});
  } catch (error) {
    if (error?.nativeNoOperationStarted) {
      await ctx.db.finishJob(id, nativeConnection(ctx), {state: 'failed', detail: 'Worker resource admission declined before clone.'});
      await ctx.db.compareAndSetSetting(key, 1, {...saved, revision: 2, phase: 'done', outcome: 'not_started', outcomeReason: 'The Git worker was too busy to start the clone; nothing ran.', workspaceDisposed: true});
      throw Object.assign(error, {noOperationStarted: true});
    }
    // An uncertain clone stays in "opening"; the next call inspects it instead of cloning again.
    return await (await saver(ctx, key, saved)).save({lastError: 'The clone outcome was not confirmed; the next call inspects it.'});
  }
  return saved;
}

const settledExecution = e => ['completed', 'failed', 'uncertain'].includes(e?.state);
const errorText = e => e?.safeMessage && typeof e.message === 'string' ? e.message.slice(0, 300) : 'A step could not be confirmed; the next call retries it.';

async function logTail(ctx, record, id, deps) {
  try {
    const first = presentPlayground(await deps.callPlayground(ctx, record, 'logs', {id, offset: 0, length: TAIL}));
    let page = first;
    if (Number.isSafeInteger(first.totalBytes) && first.totalBytes > TAIL) page = presentPlayground(await deps.callPlayground(ctx, record, 'logs', {id, offset: first.totalBytes - TAIL, length: TAIL, expectedLogHash: first.logHash}));
    return {log_tail: Buffer.from(page.base64 ?? '', 'base64').toString('utf8'), log_total_bytes: first.totalBytes ?? null, log_hash: first.logHash ?? null, log_redacted: first.redacted === true};
  } catch { return {log_tail: null, log_unavailable: true}; }
}

/** One step. Returns true when the phase moved (or the run finished), false when it waits. */
async function step(ctx, run, deps) {
  const s = run.get(), conn = nativeConnection(ctx);
  if (s.phase === 'opening') {
    const record = await deps.nativeRecord(ctx, s.workspace_id);
    const invoke = o => deps.callNativeWorker(ctx, {binding: record.binding, job: record.job, workspace_id: record.worker, ...o});
    let state = await invoke({action: 'inspect'});
    if (state.state === 'opening') return false;
    if (state.state !== 'ready') { await run.save({phase: 'disposing', outcome: 'clone_failed', outcomeReason: 'The repository could not be cloned at that ref; nothing ran.'}); return true; }
    if (SHA.test(s.ref) && state.head !== s.ref) {
      try { await invoke({action: 'run', operation: 'reset', options: {ref: s.ref, hard: true}, requestKey: 'pg_run_checkout_' + s.intent.slice(0, 40), expectedGeneration: state.generation, allowWrite: true}); } catch { /* read back below */ }
      state = await invoke({action: 'inspect'});
      if (state.head !== s.ref) { await run.save({phase: 'disposing', outcome: 'ref_unavailable', outcomeReason: 'That commit is not reachable from any branch of the repository; nothing ran.'}); return true; }
    }
    let signals, size = s.sizeRequested, sizeReason;
    try { signals = await deps.repositorySignals(ctx, record); } catch { signals = undefined; }
    if (size === 'auto') ({size, reason: sizeReason} = autoSizeFor(signals));
    else sizeReason = `Size ${size} was requested.`;
    const allocated = await deps.enqueueAllocation(ctx, record, {size, signals});
    if (!allocated) { await run.save({phase: 'disposing', head: state.head, size, sizeReason, outcome: 'no_runtime_host', outcomeReason: 'No ready computer of yours and no shared runtime pool is available, so nothing ran. Add your own computer or server from My connection to run commands.'}); return true; }
    await run.save({phase: 'provisioning', head: state.head, size, sizeReason, signals: Array.isArray(signals) ? signals.slice(0, 20) : null, runtimeImage: allocated.runtimeImage ?? null, lastError: null});
    return true;
  }
  if (s.phase === 'provisioning') {
    const record = await deps.nativeRecord(ctx, s.workspace_id);
    let a = await deps.allocationRecord(ctx, record);
    if (!a) a = await deps.enqueueAllocation(ctx, record, {size: s.size, signals: s.signals ?? undefined});
    if (a?.phase === 'attached') { await run.save({phase: 'starting', lastError: null}); return true; }
    if (!a || ['cleanup_requested', 'stopped', 'deleting', 'disposed'].includes(a.phase)) { await run.save({phase: 'disposing', outcome: 'runtime_unavailable', outcomeReason: 'The runtime was cleaned up before the command could start; nothing ran.'}); return true; }
    // The maintenance sweep may be advancing the same allocation; its "in progress" answer means wait.
    const busy = error => /in progress/i.test(String(error?.message));
    try {
      a = await deps.ensureAllocation(ctx, record, {size: s.size, signals: s.signals ?? undefined});
      if (['allocated', 'attaching'].includes(a?.phase)) a = await deps.attachRepository(ctx, await deps.nativeRecord(ctx, s.workspace_id), {budgetMs: 15000});
    } catch (error) { if (busy(error) || error?.safeRetryable) return false; throw error; }
    if (a?.phase === 'attached') { await run.save({phase: 'starting', lastError: null}); return true; }
    if (a?.phase !== s.allocationPhase) await run.save({allocationPhase: a?.phase ?? null});
    return false;
  }
  if (s.phase === 'starting') {
    const record = await deps.playgroundRecord(ctx, {owner: s.owner, repo: s.repo, workspace_id: s.workspace_id}, {allowUnattached: true});
    if (!record.allocation) return false;
    const readiness = await deps.availability(ctx, record);
    if (!readiness.execution_available) { if (readiness.retryable === true || ['enforcement_unverified', 'repository_unattached', 'runtime_unattached'].includes(readiness.reason)) return false; requirePlaygroundExecution(readiness); }
    const runtimeKey = 'pg_run_' + s.intent.slice(0, 56), id = playgroundExecutionId(record.allocation.binding, runtimeKey);
    let started;
    try { started = await deps.callPlayground(ctx, record, 'start', {requestKey: runtimeKey, argv: s.argv, cwd: s.cwd, timeoutMs: s.timeoutMs}); }
    catch (error) { if (error?.safeRetryable) return false; throw Object.assign(error, {executionId: id}); }
    await run.save({phase: 'running', execution_id: id, execution: started?.id === id ? {state: started.state} : null});
    return true;
  }
  if (s.phase === 'running') {
    const record = await deps.playgroundRecord(ctx, {owner: s.owner, repo: s.repo, workspace_id: s.workspace_id});
    const e = await deps.callPlayground(ctx, record, 'status', {id: s.execution_id});
    if (!settledExecution(e)) { if (e?.state !== s.execution?.state) await run.save({execution: {state: e?.state ?? null}}); return false; }
    const execution = {state: e.state, exitCode: e.exitCode ?? null, signal: e.signal ?? null, reason: e.reason ?? null, startedAt: e.startedAt ?? null, finishedAt: e.finishedAt ?? null};
    await run.save({phase: 'disposing', execution, ...await logTail(ctx, record, s.execution_id, deps), outcome: e.state === 'completed' && e.exitCode === 0 ? 'succeeded' : e.state === 'uncertain' ? 'uncertain' : 'failed', upsize: upsizeHint(execution, s.size)});
    return true;
  }
  if (s.phase === 'disposing') {
    let record;
    try { record = await deps.nativeRecord(ctx, s.workspace_id, {allowDisposed: true}); }
    catch { await run.save({phase: 'done', workspaceDisposed: true}); return true; }
    if (record.row.state === 'ready') { await run.save({phase: 'done', workspaceDisposed: true}); return true; }
    const cleaned = await deps.disposeAllocation(ctx, record);
    if (cleaned?.disposed !== true) return false;
    const job = {...record.job, brokerOrigin: undefined, allocationBinding: undefined};
    try { await deps.callNativeWorker(ctx, {binding: record.binding, job, workspace_id: record.worker, action: 'close', allowWrite: true}); }
    catch (error) { if (error?.status !== 404) throw error; }
    try { await deps.callNativeWorker(ctx, {binding: record.binding, job, workspace_id: record.worker, action: 'inspect', renewLease: false}); return false; }
    catch (error) { if (error?.status !== 404) throw error; }
    await ctx.db.finishJob(s.workspace_id, conn, {state: 'ready', detail: 'Native workspace disposed.'});
    await run.save({phase: 'done', workspaceDisposed: true});
    return true;
  }
  return true; // done
}

/** Advance a run within `budgetMs`. Never blocks past the budget; returns the stored state. */
export async function advanceRun(ctx, intent, {deps = defaultRunDeps, budgetMs = 40000, pollMs = 2000, maxSteps = 40} = {}) {
  const key = runSettingKey(intent), stored = await ctx.db.getSetting(key);
  if (!stored) return null;
  const run = await saver(ctx, key, stored), started = Date.now();
  for (let i = 0; i < maxSteps && run.get().phase !== 'done'; i++) {
    let moved;
    try { moved = await step(ctx, run, deps); }
    catch (error) {
      if (error?.safeCode === 'playground_run_busy') return error.fresh ?? run.get();
      if (error?.safeRetryable === true) moved = false;
      else { try { await run.save({lastError: errorText(error)}); } catch { /* another call holds it */ } return run.get(); }
    }
    if (!moved) { if (Date.now() - started + pollMs > budgetMs) break; await deps.sleep(ctx, pollMs); }
    else if (Date.now() - started > budgetMs) break;
  }
  return run.get();
}

export async function readRun(ctx, intent) { return await ctx.db.getSetting(runSettingKey(intent)); }

/** Plain result for the agent. */
export function presentRun(s) {
  if (!s) return null;
  const finished = s.phase === 'done';
  const next = finished
    ? (s.execution ? 'Finished and cleaned up. Read exit_code, outcome and log_tail; the workspace and runtime no longer exist.' : 'Finished without running the command; see outcome_reason.')
    : `Still ${s.phase}. Call github_playground_run again with the same arguments and requestKey to continue; nothing is started twice.`;
  return {
    phase: s.phase, finished, workspace_id: s.workspace_id, owner: s.owner, repo: s.repo, ref: s.ref, head: s.head ?? null,
    runtime_size: s.size ?? null, size_reason: s.sizeReason ?? null, runtime_image: s.runtimeImage ?? null, allocation_phase: s.allocationPhase ?? null,
    execution_id: s.execution_id ?? null, command_started: !!s.execution_id, command_finished: !!s.execution && ['completed', 'failed', 'uncertain'].includes(s.execution.state),
    command_succeeded: s.outcome === 'succeeded', exit_code: s.execution?.exitCode ?? null, signal: s.execution?.signal ?? null, reason: s.execution?.reason ?? null,
    ...(s.upsize ? {upsize: s.upsize} : {}), outcome: s.outcome ?? null, outcome_reason: s.outcomeReason ?? null,
    ...(s.log_tail !== undefined ? {log_tail: s.log_tail, log_total_bytes: s.log_total_bytes ?? null, log_hash: s.log_hash ?? null, untrusted: true} : {}),
    cleaned_up: s.workspaceDisposed === true, ...(s.lastError ? {last_error: s.lastError} : {}), next
  };
}
