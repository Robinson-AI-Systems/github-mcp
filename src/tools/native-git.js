import {passRefusal} from '../rtc/pass-scope.js';
import {enqueueAllocation,disposeAllocation} from '../playground/allocations.js';
import {RUNTIME_CHOICES} from '../playground/sizing.js';
import { nativeWorkerPublicKey, signNativeUploadClaim, signNativeDownloadClaim } from '../native-git/signing.js';
import { randomBytes } from 'node:crypto';
import { defineRead } from './define-read.js';
import { defineGithubWrite, explainGithubError } from './define-github-write.js';
import { TenantCapacityError } from '../tenancy/runtime-limits.js';
import { READ_OPERATIONS, WRITE_OPERATIONS, gitCommand, switchBranch, branchName, nativeOperationHelp, normalizeNativeOptions, needsErgonomicWorker, olderWorkerOptions, NATIVE_OPTIONS_VERSION } from '../native-git/commands.js';
import { DEFINITE_FAILURES, definiteFailure, nextStep, porcelainPaths } from '../native-git/outcomes.js';
import { nativeWorkspaceId, workerUrl, workerKey, nativeWorkerHost, nativeWorkerRoute, nativeBindingHash, UPLOAD_PURPOSE, UPLOAD_TTL_MS, DOWNLOAD_PURPOSE, DOWNLOAD_TTL_MS } from '../native-git/protocol.js';
import { nativeConnection, nativeOpenRequestKey, nativeRecord, authorizeNativeRepo, callNativeWorker } from '../native-git/client.js';
import { transferUrl, blockedNote, fitDigest } from '../native-git/relay.js';
import { parseDeviceOrigin, transportFetch } from '../fleet/relay.js';

const OWNER = { type: 'string', minLength: 1, maxLength: 39, pattern: '^[A-Za-z0-9-]+$' };
const REPO = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9_.-]+$' };
const WORKSPACE = { type: 'string', pattern: '^job_[a-f0-9]{16}$' };
const TEXT = { type: 'string', minLength: 1, maxLength: 256 };
const BOOL = { type: 'boolean' };
const OPTIONS = { type: 'object', additionalProperties: false, properties: {
 intentKey: { type: 'string', minLength: 1, maxLength: 128 }, all: BOOL, create: BOOL, from: TEXT, nameOnly: BOOL, prune: BOOL, tags: BOOL, noFastForward: BOOL, fastForwardOnly: BOOL, remote: TEXT, branches: { type: 'array', minItems: 1, maxItems: 20, items: TEXT }, worktree: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,60}$' }, ref: TEXT, branch: { ...TEXT, description: 'Branch name; branch_create/rename/delete accept name as alias; switch also accepts ref.' }, name: TEXT, path: { type: 'string', maxLength: 4096 }, paths: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 4096 } },
 message: { type: 'string', minLength: 1, maxLength: 10000 }, base64: { type: 'string', maxLength: 1400000 },
 expectedHead: { type: 'string', pattern: '^([a-f0-9]{40,64})?$' }, expectedFileHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
 force: BOOL, delete: BOOL, tag: BOOL, hard: BOOL, staged: BOOL, amend: BOOL, good: TEXT, bad: TEXT,
 byteOffset: { type: 'integer', minimum: 0 }, byteLength: { type: 'integer', minimum: 1, maximum: 32768 }, max: { type: 'integer', minimum: 1, maximum: 100 }
} };
const declarations = { production: 'never', confirm: 'when-needed', profiles: ['full'] };
const target = async (a, c, allowDisposed = false) => { const r = await nativeRecord(c, a.workspace_id, { allowDisposed }); return { owner: r.row.owner, repo: r.row.repo, scope: 'repo', kind: 'native-git', record: r }; };
const invoke = (c, t, a) => callNativeWorker(c, { binding: t.record.binding, job: t.record.job, workspace_id: t.record.worker, ...a });
const configured = c => { workerUrl(c.env); if (c.env?.NATIVE_GIT_WORKER_KEY) workerKey(c.env.NATIVE_GIT_WORKER_KEY); else nativeWorkerPublicKey(c.env); };

const safe = (message, safeCode, extra = {}) => Object.assign(new TypeError(message), { safeMessage: true, safeCode, ...extra });
// Resource admission before any clone is sent (shared by workspace open and github_repo_download).
async function admitClone(c, { download = false } = {}) {
 const cap=await callNativeWorker(c,{action:'capabilities'});
 if(download&&cap.direct_download!=='one-time-v1')throw safe('The native Git worker must be updated before direct downloads work. No clone was sent.','native_worker_update_required');
 if(cap.capacity_mode!=='resource-aware')throw safe('Update the native Git worker to resource-based admission before opening a new workspace.','native_worker_update_required');
 if(!cap.admission?.allowed)throw safe(`Native Git worker resource pressure: ${typeof cap.admission?.reason==='string'?cap.admission.reason.replace(/[^a-z_]/g,'').slice(0,64):'resource_observation_unavailable'}. No clone was sent.`,'native_resource_pressure',{safeRetryable:true});
}
// Records the workspace, then asks the worker to clone it. Returns the worker's answer ('ready', 'opening', or 'uncertain').
async function openWorkspace(c, t, { branch, depth, authorName, authorEmail, leaseMinutes = 240 }, requestKey) {
 const id = 'job_' + randomBytes(8).toString('hex');
 const binding = { authority: randomBytes(16).toString('hex'), connection: nativeConnection(c), owner: t.owner, repo: t.repo };
 const worker = nativeWorkspaceId(binding, requestKey);
 const host = nativeWorkerHost(c.env);
 await c.db.createJob({ id, connection: nativeConnection(c), owner: t.owner, repo: t.repo, kind: 'native-git-workspace', providerRef: JSON.stringify({ authority: binding.authority, worker, host, idleTimeoutMs: leaseMinutes * 60000 }), ttlMinutes: leaseMinutes }).catch(error=>{
  if(error instanceof TenantCapacityError) throw Object.assign(new TypeError('Active workspace capacity was reached before any clone was sent. Close a finished workspace or wait for idle cleanup, then start a new clone intent. There is no daily job-creation quota.'),{status:429,safeMessage:true,safeRetryable:true});
  throw error;
 });
 try { return { workspace_id: id, result: await callNativeWorker(c, { action: 'open', binding, job: {id,host,idleTimeoutMs:leaseMinutes*60000}, requestKey, allowWrite: true, network: true, options: { branch, depth, authorName, authorEmail, ttlMs: leaseMinutes * 60000 } }) }; }
 catch(error) {if(error.nativeNoOperationStarted){await c.db.finishJob(id,nativeConnection(c),{state:'failed',detail:'Worker resource admission declined before clone.'});throw error;}return { workspace_id: id, result: { state: 'uncertain' } }; }
}
// SINGLE-DOMAIN-1: where the authoritative copy lives and whether it can serve a one-time transfer.
// An attached workspace's copy is the runtime broker's (every native call already goes there).
const ATTACHED_FALLBACK = 'Use github_repo_download with fresh: true for a Git-only copy from GitHub (push the runtime\'s work first), or move files with github_playground_execute.';
async function transferReady(c, job) {
 if (!job.brokerOrigin) return null;
 if (parseDeviceOrigin(job.brokerOrigin)) throw safe('This workspace runs on your own computer, which one-time transfers cannot reach. ' + ATTACHED_FALLBACK, 'native_transfer_unavailable', { status: 422 });
 let ready = false;
 try {
  const answer = await transportFetch(c)(new URL('/v1/ingress', job.brokerOrigin).href, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8000) });
  const text = answer.ok ? (await answer.text()).slice(0, 4096) : '';
  ready = JSON.parse(text || '{}'); if (ready?.transfer !== 'broker-v1') ready = false;
 } catch { ready = false; }
 if (!ready) throw safe('This workspace\'s runtime uses an older runtime image that cannot serve one-time transfers. ' + ATTACHED_FALLBACK, 'native_transfer_unavailable', { status: 422 });
 return ready;
}
// One-time address: on this service's own domain when PUBLIC_BASE_URL is configured, else the worker's host.
// A dedicated broker verifies only the Ed25519 control-plane key, never a shared worker secret.
const claimEnv = (c, job) => job?.brokerOrigin ? { ...c.env, NATIVE_GIT_WORKER_KEY: undefined } : c.env;
function oneTimeAddress(c, job, kind, claim, signature) {
 const origin = new URL(nativeWorkerRoute(c.env, job)).origin, capability = `${Buffer.from(claim).toString('base64url')}.${signature}`;
 const direct = `${origin}${kind === 'd' ? '/v1/download/' : '/v1/upload/'}${capability}`;
 const relayed = transferUrl(c.env, { kind, destinationOrigin: origin, capability });
 return { url: relayed ?? direct, direct: relayed ? direct : null };
}
const open = defineGithubWrite({
 requestKey: nativeOpenRequestKey,
 explain: error => error?.safeMessage ? error.message : explainGithubError(error),
 name: 'github_git_workspace_open', area: 'git', audience: ['B', 'O', 'Op'],
 description: 'Clone an authorized repository. Use a fresh requestKey per new workspace and reuse it only for retries; a closed clone receipt is historical.',
 properties: { owner: OWNER, repo: REPO, branch: TEXT, authorName: { type: 'string', minLength: 1, maxLength: 100 }, authorEmail: { type: 'string', minLength: 1, maxLength: 254 }, depth: { type: 'integer', minimum: 1, maximum: 100000 }, leaseMinutes: { type: 'integer', minimum: 1, maximum: 1440, description: 'Idle timeout in minutes, renewed by authorized workspace activity; default 240 (four hours).' }, runtime: { type: 'string', enum: RUNTIME_CHOICES, description: 'Playground runtime size: none (Git only, no runtime), small, medium, large, or auto (operator default).' } }, required: ['repo'], declarations,
 target: (a, c) => ({ owner: a.owner ?? c.connection.default_account, repo: a.repo, scope: 'repo', kind: 'native-git' }),
 read: async (a, c, t) => { configured(c); await authorizeNativeRepo(c, t.owner, t.repo);
  const key=await nativeOpenRequestKey(c,a);
  if(await c.db.findNativeOpenChange({account:t.owner,repo:`${t.owner}/${t.repo}`,connection:c.connection.client_id??null,prefix:key}))return {};
  await admitClone(c);return {}; },
 classify: () => ({}), summarize: ({ target: t }) => `Clone ${t.owner}/${t.repo} into a private native Git workspace; worker compute and storage use the configured host.`,
 apply: async ({ args: a, ctx: c, target: t, requestKey }) => {
  const {workspace_id:id,result}=await openWorkspace(c,t,{branch:a.branch,depth:a.depth,authorName:a.authorName,authorEmail:a.authorEmail,leaseMinutes:a.leaseMinutes},requestKey);
  if(result.state==='uncertain')return {workspace_id:id,result};
  {let playground={phase:'git_only',reason:'provider_setup_required'};
   if(result.state==='opening')playground={phase:'git_only',reason:'clone_in_progress',next:'When the clone is ready, provision a runtime with github_playground_workspace operation provision if commands are needed.'};
   else if(result.state==='ready'&&a.runtime==='none')playground={phase:'git_only',reason:'runtime_not_requested',next:'Provision later with github_playground_workspace operation provision and a size if commands are needed.'};
   else if(result.state==='ready'&&!passRefusal({tool:{name:'github_playground_workspace',area:'playground',writes:true,inputSchema:{properties:{repo:{}}}},args:{owner:t.owner,repo:t.repo},connection:c.connection})){try{const allocated=await enqueueAllocation(c,await nativeRecord(c,id),{size:a.runtime});playground=!allocated?{phase:'git_only',reason:'no_runtime_host',next:'No ready computer of yours and no shared runtime pool is available. Add your own computer or server from My connection to run commands.'}:{placement:allocated.placement??'operator_pool',phase:allocated.phase,workspace_id:id,runtime_size:allocated.size??null,next:'Allocation manager will provision and attach this workspace; read Playground allocation for progress.'};}catch{playground={phase:'git_only',reason:'allocation_recovery_required',next:'Git work is preserved; inspect Playground allocation with this same workspace ID.'};}}
   return {workspace_id:id,result,playground};}
 },
 readAfter: async ({ ctx: c, response }) => {
  const record = await nativeRecord(c, response.workspace_id);
  try { return { workspace_id: response.workspace_id, playground:response.playground, ...await callNativeWorker(c, { action: 'inspect', binding: record.binding, job: record.job, workspace_id: record.worker, renewLease: true }) }; }
  catch { return { workspace_id: response.workspace_id, state: 'uncertain', next: 'Use github_git_workspace_read status; do not open another clone to retry this intent.' }; }
 },
 verify: ({ after }) => ['ready', 'opening'].includes(after.state), present: ({ after, response }) => after?.state === 'opening' ? { ...after, next: 'Large repository: the clone continues on the worker. Read github_git_workspace_read operation status until state is ready (or failed); do not open another clone.' } : after ?? response
});
const read = defineRead({
 name: 'github_git_workspace_read', area: 'git', audience: ['B', 'O', 'Op'], byteWindow: true,
 description: 'Read native Git status, history, diffs, conflicts, refs or exact file byte windows from this connection’s workspace.',
 properties: { workspace_id: WORKSPACE, operation: { type: 'string', enum: ['capabilities', ...READ_OPERATIONS] }, options: OPTIONS, byteOffset: { type: 'integer', minimum: 0 }, byteLength: { type: 'integer', minimum: 1, maximum: 32768 },
  owner: OWNER, repo: REPO, path: OPTIONS.properties.path, paths: OPTIONS.properties.paths, ref: TEXT }, required: ['operation'],
 handler: async (input, c) => { const a = { ...input }; for (const key of ['path', 'paths', 'ref']) if (a[key] !== undefined) { if (a.options?.[key] !== undefined && JSON.stringify(a.options[key]) !== JSON.stringify(a[key])) throw new TypeError(`${key} was given both at the top level and in options; give it once.`); a.options = { ...(a.options ?? {}), [key]: a[key] }; delete a[key]; }
  if (a.operation === 'capabilities') {
  let worker; try { worker = await callNativeWorker(c, { action: 'capabilities' }); } catch { worker = { ready: false, setup_required: true }; }
  return { bulk_upload: { tool: 'github_git_workspace_upload', next: 'For more than about 1 MB of files: one-time git push or curl upload URL straight to this worker, then apply.' }, bulk_download: { tool: 'github_git_workspace_download', next: 'For the whole workspace or many files: one-time git clone or curl .tar.gz URL straight from this worker.' }, playground: {tools:['github_playground_execute','github_playground_read','github_playground_cancel'],next:'Search/describe/call these agent tools for commands, builds and tests in an attached isolated runtime. This Git worker remains typed Git only.'}, operation_help: a.options?.name ? nativeOperationHelp(a.options.name) : { next: 'Call capabilities with options.name set to an operation for exact options and an example.' }, worker, read_operations: READ_OPERATIONS, write_operations: WRITE_OPERATIONS, setup: 'https://github.com/Robinson-AI-Systems/github-mcp/blob/main/docs/NATIVE-GIT-OPERATIONS.md', unsupported: [
    { feature: 'LFS', guidance: 'Install git-lfs locally, run git lfs install in your trusted local clone, and use git lfs pull/push with your own GitHub authorization.' },
    { feature: 'submodules', guidance: 'Use a trusted isolated local clone, review .gitmodules origins, then git submodule update --init --recursive with separate repository permissions.' },
    { feature: 'executable hooks/filters, signing, custom remotes and arbitrary shell/bisect run in the Git worker', guidance: 'For commands/builds/tests, use github_playground_execute in an attached isolated Robinson Playground runtime. This Git worker stays typed Git; advanced credentialed Git configuration still uses the documented trusted local alternative.' }
   ], cost: 'The initial worker is a running container on the configured host, not scale-to-zero. Compute, persistent storage and transfer depend on that host; no zero-idle-cost claim. Portable encrypted snapshots support moving to an owned host.' };
 } if (a.operation === 'read_file' && a.byteLength === undefined) throw new TypeError('Exact file reads require byteLength (1–32768), optional byteOffset, and options.path; use the returned file_hash as options.expectedFileHash for continuation.'); const r = await nativeRecord(c, a.workspace_id);
  for (const [key, expected] of [['owner', r.row.owner], ['repo', r.row.repo]]) if (a[key] !== undefined && a[key].toLowerCase() !== expected.toLowerCase()) throw new TypeError(`This workspace belongs to ${r.row.owner}/${r.row.repo}, not the ${key} you gave.`);
  if (needsErgonomicWorker(a.operation, normalizeNativeOptions(a.operation, a.options ?? {})) && (await callNativeWorker(c, { action: 'capabilities', job: r.job }).catch(() => ({}))).native_options !== NATIVE_OPTIONS_VERSION)
   throw new TypeError(`The native Git worker serving this workspace must be updated for ${a.operation === 'changed_files' ? 'changed_files' : 'these options'}. Meanwhile use status (uncommitted changes) or diff with options.ref.`);
  return callNativeWorker(c, { binding: r.binding, job: r.job, workspace_id: r.worker, action: a.operation === 'status' ? 'inspect' : 'read', operation: a.operation, options: { ...(a.options ?? {}), ...(a.byteOffset !== undefined ? { byteOffset: a.byteOffset } : {}), ...(a.byteLength !== undefined ? { byteLength: a.byteLength } : {}) }, network: a.operation === 'remote_refs' }); }
});
// NATIVE-ERGO-1: what a stale expectedGeneration or another definite worker refusal needs: the
// current generation, read once after the refusal (nothing was changed by the refused call).
async function generationHelp(c, t, error, operation) {
 if (!error?.safeMessage || ![400, 422].includes(error.status)) return error;
 let generation = null; try { generation = (await invoke(c, t, { action: 'inspect', renewLease: false })).generation ?? null; } catch { generation = null; }
 const stale = /generation changed|Stale expectedGeneration/i.test(error.message);
 const message = stale ? `Stale expectedGeneration: nothing was changed.${Number.isSafeInteger(generation) ? ` The workspace is at generation ${generation}; send expectedGeneration ${generation} with a new requestKey.` : ' Read status for the current generation, then send it with a new requestKey.'}`
  : `${error.message}${Number.isSafeInteger(generation) ? ` Next expectedGeneration: ${generation}.` : ''}`;
 return Object.assign(new TypeError(message.slice(0, 900)), { safeMessage: true, status: error.status, safeCode: stale ? 'stale_generation' : error.safeCode,
  outcomeDetails: { outcome: stale ? 'stale_generation' : 'refused', operation, ...(Number.isSafeInteger(generation) ? { next_generation: generation } : {}) } });
}
const workerFeatures = async (c, t) => { try { return await callNativeWorker(c, { action: 'capabilities', job: t.record.job }); } catch { return {}; } };
// Canonical options for this worker: aliases folded; an older worker gets the same intent in the shape it knows.
async function runOptions(c, t, a, before) {
 let options = normalizeNativeOptions(a.operation, a.options ?? {});
 const needs = needsErgonomicWorker(a.operation, options);
 if (!needs && !(a.operation === 'fetch' && options.branches)) return { options, worker: null };
 const cap = await workerFeatures(c, t);
 if (cap.native_options === NATIVE_OPTIONS_VERSION) return { options, worker: cap.native_options };
 if (a.operation === 'add' && options.all) {
  const paths = porcelainPaths(before?.status ?? '');
  if (!paths.length) throw safe('There is nothing to add: the workspace has no changes.', 'invalid_native_arguments');
  if (paths.length > 100) throw safe(`The native Git worker must be updated before add all works for more than 100 changed paths (${paths.length} here). Meanwhile, add them in groups of up to 100 with options.paths.`, 'native_worker_update_required');
  return { options: { paths }, worker: null, expanded: paths.length };
 }
 if (!needs) return { options: olderWorkerOptions(a.operation, options), worker: null };
 const meanwhile = { remove_file: 'remove one path per call with options.path', switch: 'branch_create, then switch', changed_files: 'use diff with options.ref', merge: 'merge with options.ref only', fetch: 'fetch without prune/tags', diff: 'diff without nameOnly' }[a.operation] ?? 'use the basic options';
 throw safe(`The native Git worker serving this workspace must be updated for these ${a.operation} options. Nothing was sent. Meanwhile: ${meanwhile}.`, 'native_worker_update_required');
}
const RUN_SHORTCUTS = ['path', 'paths', 'branch', 'ref', 'message', 'all'];
const run = defineGithubWrite({
 name: 'github_git_workspace_run', area: 'git', audience: ['B', 'O', 'Op'],
 description: 'Run typed native Git operations. Read capabilities with options.name set to the operation for exact required arguments and examples.',
 guidance: 'options carries the operation\'s arguments; path, paths, branch, ref, message and all are also accepted at the top level. add with all: true (or paths ["."]) stages every change; remove_file takes paths; fetch takes branch/branches; merge takes ref or branch; switch with create: true makes a new branch. Every reply has next_generation for the next call; quiet: true keeps the reply short. A conflict or refusal is a definite result with a next step.',
 properties: { workspace_id: WORKSPACE, operation: { type: 'string', enum: WRITE_OPERATIONS }, expectedGeneration: { type: 'integer', minimum: 0 }, options: OPTIONS,
  quiet: { ...BOOL, description: 'Short reply: outcome, branch, head, next_generation and counts, without Git output or full status.' },
  owner: OWNER, repo: REPO, path: OPTIONS.properties.path, paths: OPTIONS.properties.paths, branch: OPTIONS.properties.branch, ref: TEXT, message: OPTIONS.properties.message, all: BOOL },
 required: ['workspace_id', 'operation', 'expectedGeneration'], declarations: { ...declarations, production: 'when-target' },
 explain: error => error?.safeMessage ? error.message : 'Native Git operation could not be confirmed. Inspect workspace state and the same intent receipt before retrying.',
 // The worker answers 400/404/422 only for checks that refused before any change (a definite no).
 classifyError: error => [400,401,404,409,422,429].includes(error?.status) ? 'rejected' : 'uncertain',
 target, read: async (a, c, t) => { configured(c);
  for (const [key, expected] of [['owner', t.owner], ['repo', t.repo]]) if (a[key] !== undefined && a[key].toLowerCase() !== expected.toLowerCase()) throw safe(`This workspace belongs to ${t.owner}/${t.repo}, not the ${key} you gave. Use that workspace's own repository, or open a workspace for the other one.`, 'invalid_native_arguments');
  try { gitCommand(a.operation, a.options ?? {}); } catch (error) { throw Object.assign(new TypeError(`Native ${a.operation} arguments: ${error.message}`), { safeMessage: true,safeCode:'invalid_native_arguments' }); }
  let state; try { state = await invoke(c, t, { action: 'inspect', options: { worktree: a.options?.worktree } }); } catch (error) { if (error.safeMessage) error.message = `Native ${a.operation} preflight: ${error.message}`.slice(0,300); throw error; }
  // A stale expectedGeneration is not refused here: the same call again must still replay its first result.
  const shaped = await runOptions(c, t, a, state);
  return { ...state, send: shaped }; },
 classify: ({ args: a }) => a.operation === 'push' ? { production: 'push changes exact GitHub remote refs; GitHub permissions and repository rules apply' } : {},
 price: () => 0, // Git ref transport itself does not buy seats/compute; disclose repository-automation costs separately.
 summarize: ({ args: a, target: t, before }) => `Native Git ${a.operation} in ${t.owner}/${t.repo} at workspace generation ${a.expectedGeneration}${before?.send?.expanded ? ` (${before.send.expanded} changed paths)` : ''}${a.operation === 'push' ? '; future GitHub automation costs may be unknown' : ''}`,
 apply: async ({ args: a, ctx: c, target: t, requestKey, before }) => {
  const options = before?.send?.options ?? normalizeNativeOptions(a.operation, a.options ?? {});
  let result;
  try { result = await invoke(c, t, { action: 'run', operation: a.operation, options, requestKey, expectedGeneration: a.expectedGeneration, allowWrite: true, network: ['fetch', 'pull', 'push'].includes(a.operation) }); }
  catch (error) { throw await generationHelp(c, t, error, a.operation); }
  if (DEFINITE_FAILURES.has(result?.status)) throw definiteFailure(a.operation, result, options);
  return result;
 },
 readAfter: async ({ args: a, ctx: c, target: t, response }) => {
  const after = {operation:response,workspace:await invoke(c,t,{action:'inspect',options:{worktree:a.options?.worktree}})};
  if (['branch_create','branch_rename','branch_delete'].includes(a.operation)) {
   const name=branchName(a.options), full='refs/heads/'+name;
   const refs=await invoke(c,t,{action:'read',operation:'refs',options:{ref:full,worktree:a.options?.worktree}});
   const match=refs.stdout.split('\n').map(line=>line.split('\0')).find(parts=>parts[0]===full);
   after.reference={name,exists:!!match,head:match?.[1]??null};
  }
  return after;
 },
 // A conflict is a definite outcome: the operation ran and stopped with the listed files (read back).
 verify: ({ args: a, after }) => {
  const op = after.operation, ws = after.workspace;
  if (op.status === 'conflict') return ws.generation === op.generation && ws.conflicts?.length > 0;
  return op.status === 'applied' && ws.generation === op.generation && (a.operation !== 'push' || op.remote_verified === true) && (a.operation !== 'switch' || ws.branch === switchBranch(normalizeNativeOptions('switch', a.options ?? {}))) && (!['branch_create','branch_rename','branch_delete'].includes(a.operation) || after.reference.exists === (a.operation !== 'branch_delete'));
 },
 essentials: shaped => shaped?.outcome ? { outcome: shaped.outcome, next_generation: shaped.next_generation ?? null, branch: shaped.branch ?? null, head: shaped.head ?? null, ...(shaped.conflicts?.length ? { conflicts: shaped.conflicts.slice(0, 10) } : {}), ...(shaped.next ? { next: String(shaped.next).slice(0, 400) } : {}) } : null,
 present: ({ args: a, after, response }) => {
  if (!after) return response;
  const op = after.operation ?? {}, ws = after.workspace ?? {};
  const outcome = op.status === 'conflict' ? 'conflict' : op.status === 'applied' ? 'applied' : op.status ?? 'unknown';
  const summary = { outcome, next_generation: ws.generation ?? op.next_generation ?? null, branch: ws.branch ?? null, head: ws.head ?? null,
   changed_paths: porcelainPaths(ws.status).length, ...(ws.conflicts?.length ? { conflicts: ws.conflicts } : {}), ...(ws.in_progress?.length ? { in_progress: ws.in_progress } : {}),
   ...(op.remote_verified !== undefined ? { remote_verified: op.remote_verified, remote_head: op.remote_head ?? null } : {}), ...(op.removed ? { removed: op.removed } : {}), ...(after.reference ? { reference: after.reference } : {}),
   ...(outcome === 'conflict' ? { next: nextStep(a.operation, { ...op, conflicts: ws.conflicts }, a.options ?? {}) } : {}) };
  return a.quiet ? { operation: a.operation, ...summary } : { ...after, ...summary };
 }
});
// Top-level shortcuts (path, paths, branch, ref, message, all) are folded into options; owner/repo are checked against the workspace.
const runHandler = run.handler;
const foldRunArgs = args => {
 if (!args || typeof args !== 'object' || Array.isArray(args)) return { args };
 const folded = { ...args }, options = { ...(args.options ?? {}) };
 for (const key of RUN_SHORTCUTS) if (folded[key] !== undefined) {
  if (options[key] !== undefined && JSON.stringify(options[key]) !== JSON.stringify(folded[key])) return { error: `${key} was given both at the top level and in options with different values; give it once (inside options).` };
  options[key] = folded[key]; delete folded[key];
 }
 if (Object.keys(options).length || args.options !== undefined) folded.options = options;
 return { args: folded };
};
const runWithShortcuts = (args, ctx) => {
 const { args: folded, error } = foldRunArgs(args);
 if (error) { const body = { done: false, status: 'refused', reason_code: 'invalid_request', retryable: false, no_change_sent: true, error }; return { isError: true, content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body }; }
 return runHandler(folded, ctx);
};
// The runtime-attached copy lives on the dedicated broker; once that runtime is deleted, the
// workspace is closed and read back on the source Git worker (never the deleted broker).
const sourceTarget = t => ({ ...t, record: { ...t.record, job: { ...t.record.job, brokerOrigin: undefined, allocationBinding: undefined } } });
const CLOSED = 'Native workspace disposed.';
// Delete the workspace's Playground runtime first, waiting (bounded) for whole-process absence.
async function disposeRuntimeFor(c, record, budgetMs = c.runtimeDisposeBudgetMs ?? 20000) {
 const started = Date.now();
 for (;;) {
  const allocation = await disposeAllocation(c, record);
  if (allocation.disposed === true) return;
  if (Date.now() - started + 2000 > budgetMs)
   throw Object.assign(new TypeError('The workspace\'s Playground runtime is still being deleted; its files are preserved and nothing was closed yet. Call github_git_workspace_close again with the same arguments in about a minute.'), { safeMessage: true, status: 409, safeRetryable: true });
  await (c.sleep ?? (ms => new Promise(r => setTimeout(r, ms))))(2000);
 }
}
// Read back on the source worker; 404 = gone. Brief worker refusals right after a close are retried.
async function confirmClosed(c, t, workspaceId) {
 for (let attempt = 0; ; attempt++) {
  try { await invoke(c, sourceTarget(t), { action: 'inspect', renewLease: false }); return { state: 'pending' }; }
  catch (error) {
   if (error.status === 404) break;
   const transient = error.nativeCode === 'native_busy' || error.nativeCode === 'native_transport' || [429, 502, 503, 504].includes(error.status);
   if (!transient || attempt >= 3) throw error;
   await (c.sleep ?? (ms => new Promise(r => setTimeout(r, ms))))(500 * 2 ** attempt);
  }
 }
 return await c.db.finishJob(workspaceId, nativeConnection(c), { state: 'ready', detail: CLOSED }) ?? c.db.getJob(workspaceId, nativeConnection(c));
}
async function closeSource(c, t) {
 try { return await invoke(c, sourceTarget(t), { action: 'close', allowWrite: true }); }
 catch (error) { if (error.status === 404) return { disposed: true }; throw error; }
}
const close = defineGithubWrite({
 name: 'github_git_workspace_close', area: 'git', audience: ['B', 'O', 'Op'],
 description: 'Dispose this connection’s native Git workspace, including uncommitted changes; never deletes the GitHub repository.',
 properties: { workspace_id: WORKSPACE }, required: ['workspace_id'], declarations: { ...declarations, production: 'when-target' },
 explain: error => error?.safeMessage ? error.message : 'Native Git operation could not be confirmed. Inspect workspace state and the same intent receipt before retrying.',
 classifyError: error => [401,409,429].includes(error?.status) ? 'rejected' : 'uncertain', target: (a, c) => target(a, c, true),
 read: async (_a, c, t) => { try { return await invoke(c, t, { action: 'inspect', renewLease: false }); } catch (e) { if (e.status === 404) return { disposed: true }; throw e; } }, classify: () => ({}), summarize: ({ target: t }) => `Dispose native workspace for ${t.owner}/${t.repo}; uncommitted local work is deleted.`,
 apply: async ({ ctx: c, target: t, before }) => { await disposeRuntimeFor(c, t.record); if (before.disposed) return { disposed: true }; return await closeSource(c, t); },
 readAfter: ({ args: a, ctx: c, target: t }) => confirmClosed(c, t, a.workspace_id),
 // PG-STUCK-1: the same call again (same requestKey) finishes an unconfirmed close instead of
 // forcing a new key: runtime deletion, source close and readback are each idempotent.
 resumeReplay: true,
 refreshReplay: async ({ args: a, ctx: c, target: t }) => {
  const row = await c.db.getJob(a.workspace_id, nativeConnection(c));
  if (row?.state === 'ready' && row.detail === CLOSED) return row;
  await disposeRuntimeFor(c, t.record);
  await closeSource(c, t);
  return confirmClosed(c, t, a.workspace_id);
 },
 verify: ({ after }) => after?.state === 'ready' && after.detail === CLOSED, present: ({ after }) => ({ disposed: after?.state === 'ready' && after.detail === CLOSED })
});
const list = defineRead({
 name: 'github_git_workspace_list', area: 'git', audience: ['B', 'O', 'Op'],
 description: 'Page this connection’s active native Git workspaces after fresh repository authorization; unavailable names are withheld.',
 properties: { after: WORKSPACE, max: { type: 'integer', minimum: 1, maximum: 20 } }, handler: async (a, c) => {
  const limit = a.max ?? 10; const page = await c.db.listNativeGitWorkspaces(nativeConnection(c), { after: a.after ?? null, limit }); const rows = page.slice(0, limit); const next = page.length > limit ? rows.at(-1).id : null; const items = []; let unavailable = 0;
  for (const row of rows) { try { await authorizeNativeRepo(c, row.owner, row.repo); items.push({ workspace_id: row.id, owner: row.owner, repo: row.repo, expires_at: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at }); } catch { unavailable++; } }
  return { items, checked: rows.length, unavailable, next_cursor: next, complete: next === null && unavailable === 0, note: 'Unavailable repository names are withheld. Follow next_cursor even when a page has no accessible items; omissions never prove absence.' };
 }
});
// GIT-UPLOAD-1: bulk bytes go straight to the worker. The returned address carries a signed,
// single-use, ten-minute capability for one quarantine area of this workspace — never a GitHub
// or provider credential. The address is returned once (it is not stored in the change log).
const uploadRefusal = reason => Object.assign(new TypeError(String(reason ?? 'The upload was refused.').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 600)), { safeMessage: true, safeCode: 'native_upload_refused', status: 422 });
// Clients never follow redirects from a one-time address (git -c http.followRedirects=false; curl without -L).
// The one-request archive upload sends its own SHA-256, so damaged bytes are refused on receipt (CHUNK-UPLOAD-1).
const UPLOAD_COMMAND = { git: url => `git -c http.followRedirects=false push "${url}" HEAD:refs/heads/upload`, archive: url => `curl --fail -H "X-Content-SHA256: $(sha256sum files.tar.gz|cut -c1-64)" --upload-file files.tar.gz "${url}"` };
export const UPLOAD_COMMAND_SINGLE_WITH_DIGEST = UPLOAD_COMMAND.archive;
// CHUNK-UPLOAD-1: resumable upload in requests of at most 4 MiB, with plain shell tools only (split, curl,
// wc, sha256sum; git bundle in git mode). Rerunning it resumes: stored chunks answer as duplicates. The
// worker checks every offset, then the whole size and SHA-256 at finish, before anything is quarantined.
// Kept terse on purpose: the command must fit the always-visible 1200-byte digest with the URL in it.
const chunkLoop = (url, file) => `U="${url}";F=${file};split -b4m -a4 $F .u.&&o=0&&for c in .u.????;do curl -fsS --retry 4 -o/dev/null -T $c "$U/chunk?offset=$o"||break;o=$((o+$(wc -c<$c)));done;rm -f .u.????;curl -sS -XPOST "$U/finish?size=$(($(wc -c<$F)))&sha256=$(sha256sum $F|cut -c1-64)"`;
export const CHUNKED_UPLOAD_COMMAND = {
 archive: url => chunkLoop(url, 'files.tar.gz'),
 git: (url, base) => `git bundle create .u.b HEAD${base ? ' --not ' + base.slice(0, 16) : ''}&&${chunkLoop(url, '.u.b')};rm -f .u.b`
};
const CHUNK_NOTE = { archive: 'command sends files.tar.gz in 4 MiB requests and resumes when run again (stored chunks are skipped); it prints the finish result. single_command is one request, fine below about 8 MB.',
 git: 'command bundles your commits since the workspace HEAD (git bundle) and sends them in 4 MiB requests; it resumes when run again. single_command is a git push, fine below about 8 MB.' };
/** The commands an upload result shows: resumable chunks when the worker supports them, else the one request. */
function uploadCommands(mode, url, response) {
 if (!response?.chunks) return { command: UPLOAD_COMMAND[mode](url) };
 return { command: CHUNKED_UPLOAD_COMMAND[mode](url, response.base ?? null), single_command: UPLOAD_COMMAND[mode](url), chunk_note: CHUNK_NOTE[mode] + ' On macOS use shasum -a 256 for sha256sum. Progress: curl -sS "<url>/status".' };
}
async function beginUpload(c, t, a, requestKey, chunks = false) {
 const uploadId = randomBytes(16).toString('hex'), nonce = randomBytes(16).toString('hex');
 const maxBytes = (a.maxMegabytes ?? 50) * 1048576, expiresAt = (c.now ?? Date.now)() + UPLOAD_TTL_MS;
 const begun = await invoke(c, t, { action: 'upload_begin', options: { uploadId, mode: a.mode, maxBytes, expiresAt, nonce }, requestKey, allowWrite: true });
 const claim = JSON.stringify({ purpose: UPLOAD_PURPOSE, version: 1, workspace_id: t.record.worker, binding: nativeBindingHash(t.record.binding), mode: a.mode, maxBytes, expiresAt, uploadId, nonce });
 return { ...begun, ...(chunks ? { chunks: true } : {}), ...oneTimeAddress(c, t.record.job, 'u', claim, signNativeUploadClaim(claim, claimEnv(c, t.record.job))) };
}
// Returns whether resumable chunks work end to end: the worker (or runtime broker) and, for a runtime, its ingress.
async function uploadPreflight(c, record) {
 const ingress = await transferReady(c, record.job);
 const cap = await callNativeWorker(c, { action: 'capabilities', job: record.job });
 if (cap.direct_upload !== 'quarantine-v1') throw safe('The native Git worker must be updated before direct uploads work. Use write_file (about 1 MB per call) meanwhile.', 'native_worker_update_required');
 return cap.upload_chunks === 'chunks-v1' && (ingress === null || ingress?.upload_chunks === 'v1');
}
const upload = defineGithubWrite({
 name: 'github_git_workspace_upload', area: 'git', audience: ['B', 'O', 'Op'],
 description: 'Move many or large files into a native workspace: begin returns a one-time git push or curl upload URL; apply checks what arrived and adds it.',
 guidance: 'For more than about 1 MB of files. begin (mode git or archive, fresh requestKey) returns a private URL on this service\'s own domain for one upload started within 10 minutes, and `command`: a copy-paste shell line that splits the file into 4 MiB requests (split + curl), resumes when run again, and finishes with the size and sha256sum the worker checks (archive: files.tar.gz, .tar.gz/.tar/.zip; git: a git bundle of your commits since the workspace HEAD). `single_command` (one curl --upload-file or git push) is fine below about 8 MB. Works for workspaces attached to a Playground runtime too. Then apply with upload_id and the current expectedGeneration: git fast-forwards the workspace branch; archive extracts under optional path. Links, .git paths, oversize files and credential-shaped content are refused. Commit and push with github_git_workspace_run. If the sandbox cannot reach the domain, add that one domain to its network allowlist once (for Claude: the Capabilities / network access allowed-domains setting); it is the same for every repository. If that domain refuses an upload (HTTP 413 or repeated 502), run direct_command instead (the worker\'s own host). Do not publish the URL.',
 properties: { workspace_id: WORKSPACE, operation: { type: 'string', enum: ['begin', 'apply'] }, mode: { type: 'string', enum: ['git', 'archive'], description: 'begin: git = receive one git push; archive = receive one .tar.gz/.tar/.zip file.' },
  maxMegabytes: { type: 'integer', minimum: 1, maximum: 100, description: 'begin: upload size cap in MiB (default 50).' }, upload_id: { type: 'string', pattern: '^upl_[a-f0-9]{32}$' },
  expectedGeneration: { type: 'integer', minimum: 0 }, ref: { ...TEXT, description: 'apply (git): pushed branch to apply when several were pushed.' }, path: { type: 'string', minLength: 1, maxLength: 1024, description: 'apply (archive): workspace subfolder to extract into (default the repository root).' },
  deletePaths: { type: 'array', minItems: 1, maxItems: 1000, items: { type: 'string', minLength: 1, maxLength: 4096 }, description: 'apply (archive): workspace files to delete in the same step.' },
  mirror: { ...BOOL, description: 'apply (archive): also delete tracked files under path that the archive does not contain.' } },
 required: ['workspace_id', 'operation'], declarations,
 explain: error => error?.safeMessage ? error.message : 'The native upload could not be confirmed. Inspect workspace state and the same intent receipt before retrying.',
 classifyError: error => [400, 401, 404, 409, 422, 429].includes(error?.status) ? 'rejected' : 'uncertain',
 target, read: async (a, c, t) => { configured(c);
  // Harmless extras (expectedGeneration on begin, mode/maxMegabytes on apply) are ignored; arguments that
  // only make sense in the other step are refused with that step named, so nothing is silently lost.
  const wrong = (a.operation === 'begin' ? ['upload_id', 'ref', 'path', 'deletePaths', 'mirror'] : []).filter(k => a[k] !== undefined);
  if (wrong.length) throw Object.assign(new TypeError(`${wrong.join(', ')} ${wrong.length > 1 ? 'belong' : 'belongs'} to operation apply (after the upload has run), not begin. Call begin with mode only, run the returned command, then call apply with upload_id${wrong.some(k => k !== 'upload_id') ? ' and ' + wrong.filter(k => k !== 'upload_id').join(', ') : ''}.`), { safeMessage: true, safeCode: 'invalid_upload_arguments' });
  if (a.operation === 'begin' && !a.mode) throw Object.assign(new TypeError('begin requires mode: git (one git push) or archive (one .tar.gz/.tar/.zip upload).'), { safeMessage: true, safeCode: 'invalid_upload_arguments' });
  if (a.operation === 'apply' && (a.upload_id === undefined || a.expectedGeneration === undefined)) throw Object.assign(new TypeError('apply requires upload_id from begin and the current expectedGeneration.'), { safeMessage: true, safeCode: 'invalid_upload_arguments' });
  if (a.operation === 'begin') t.chunks = await uploadPreflight(c, t.record);
  if (a.operation === 'apply' && (a.deletePaths || a.mirror) && (await workerFeatures(c, t)).upload_apply !== 'delete-v1') throw Object.assign(new TypeError('The native Git worker must be updated before deletePaths or mirror work on apply. Nothing was applied. Meanwhile, apply without them and delete with github_git_workspace_run remove_file.'), { safeMessage: true, safeCode: 'native_worker_update_required' });
  return await invoke(c, t, { action: 'inspect' }); },
 classify: () => ({}), price: () => 0,
 summarize: ({ args: a, target: t }) => a.operation === 'begin' ? `Open a one-time ${a.mode ?? ''} upload into the native workspace for ${t.owner}/${t.repo} (quarantined until applied)` : `Apply quarantined upload ${a.upload_id} to the native workspace for ${t.owner}/${t.repo} at generation ${a.expectedGeneration}`,
 apply: async ({ args: a, ctx: c, target: t, requestKey }) => {
  if (a.operation === 'apply') {
   let result;
   try { result = await invoke(c, t, { action: 'upload_apply', options: { uploadId: a.upload_id.slice(4), ...(a.ref !== undefined ? { ref: a.ref } : {}), ...(a.path !== undefined ? { path: a.path } : {}), ...(a.deletePaths ? { deletePaths: a.deletePaths } : {}), ...(a.mirror ? { mirror: true } : {}) }, requestKey, expectedGeneration: a.expectedGeneration, allowWrite: true }); }
   catch (error) { throw await generationHelp(c, t, error, 'upload apply'); }
   if (result.status === 'refused') throw Object.assign(uploadRefusal(result.reason), { outcomeDetails: { outcome: 'refused', operation: 'upload apply', next_generation: a.expectedGeneration } });
   return result;
  }
  return beginUpload(c, t, a, requestKey, t.chunks === true);
 },
 readAfter: async ({ args: a, ctx: c, target: t, response }) => a.operation === 'begin'
  ? { ...await invoke(c, t, { action: 'upload_status', options: { uploadId: String(response.upload_id ?? '').slice(4) } }), address_shown_once: true }
  : { operation: response, workspace: await invoke(c, t, { action: 'inspect' }) },
 verify: ({ args: a, after, response }) => a.operation === 'begin'
  ? after.state === 'awaiting' && after.upload_id === response.upload_id && after.mode === a.mode && typeof response.url === 'string'
  : after.operation.status === 'applied' && after.workspace.generation === after.operation.generation && after.workspace.head === after.operation.head,
 // Compact clients drop large `result` objects; the one-time command (which carries the URL) and the
 // apply summary must stay visible or the feature is unusable there.
 essentials: shaped => shaped?.command
  ? fitDigest({ upload_id: shaped.upload_id, command: shaped.command, single_use: true, if_blocked: shaped.single_command ? blockedNote(shaped.url, { short: true }) : shaped.if_blocked, next: shaped.next, ...(shaped.direct_command ? { direct_command: shaped.direct_command } : {}) }, ['direct_command', 'next', 'single_use', 'upload_id'])
  : (shaped && 'generation' in shaped) || shaped?.workspace
   ? { applied: true, mode: shaped.mode, target: shaped.target, files_added: shaped.files_added, files_changed: shaped.files_changed, files_deleted: shaped.files_deleted, bytes: shaped.bytes, workspace: shaped.workspace, next_generation: shaped.next_generation, next: shaped.next }
   : shaped?.next ? { next: shaped.next } : null,
 present: ({ args: a, after, response }) => {
  if (a.operation === 'apply') { const { status: _status, stdout: _o, stderr: _e, ...summary } = after?.operation ?? response ?? {}; return { ...summary, workspace: after?.workspace ? { generation: after.workspace.generation, branch: after.workspace.branch, head: after.workspace.head } : undefined, next_generation: after?.workspace?.generation ?? null, next: 'Review with github_git_workspace_read (status or changed_files), then add (all: true), commit and push with github_git_workspace_run, or do all three with github_repo_change and this workspace_id.' }; }
  if (typeof response?.url !== 'string') return { ...after, next: 'The upload address is shown only once. Begin a new upload with a fresh requestKey if you no longer have it.' };
  const commands = uploadCommands(a.mode, response.url, response);
  return { ...after, url: response.url, ...commands, single_use: true, if_blocked: blockedNote(response.url),
   ...(response.direct ? { direct_command: uploadCommands(a.mode, response.direct, response).command, direct_note: 'Second option only if this service\'s domain refuses the upload (HTTP 413 or repeated 502): the same one-time link on the worker\'s own host, which the sandbox may need to allow too.' } : {}),
   next: commands.single_command
    ? `Start within 10 minutes (one upload; a started chunked upload may finish for 20 more), then call apply with upload_id ${after.upload_id} and the current expectedGeneration. Do not publish the URL; it holds no GitHub credential.`
    : `Run within 10 minutes (works once), then call apply with upload_id ${after.upload_id} and the current expectedGeneration. Do not publish the URL; it holds no GitHub credential.` };
 }
});
// GIT-DOWNLOAD-1: the mirror of upload. begin snapshots the workspace on the worker and returns a
// signed, ten-minute address for one read-only clone session or one archive download — never a
// GitHub or provider credential. The address is returned once (it is not stored in the change log).
const DOWNLOAD_COMMAND = { git: url => `git -c http.followRedirects=false clone "${url}" repo`, archive: url => `curl -fsS "${url}" -o repo.tar.gz && mkdir -p repo && tar -xzf repo.tar.gz -C repo` };
const downloadRefusal = reason => Object.assign(new TypeError(String(reason ?? 'The download was refused.').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 600)), { safeMessage: true, safeCode: 'native_download_refused', status: 422 });
const downloadArgs = a => { if (a.mode === 'git' && a.ref === 'worktree') throw safe('ref "worktree" is for mode archive; a git clone carries commits only. Commit first, or use mode archive.', 'invalid_download_arguments'); };
async function downloadPreflight(c, record) {
 await transferReady(c, record.job);
 const cap = await callNativeWorker(c, { action: 'capabilities', job: record.job });
 if (cap.direct_download !== 'one-time-v1') throw safe('The native Git worker must be updated before direct downloads work. Use github_git_workspace_read read_file meanwhile.', 'native_worker_update_required');
}
async function beginDownload(c, t, a, requestKey) {
 const downloadId = randomBytes(16).toString('hex'), nonce = randomBytes(16).toString('hex');
 const maxBytes = (a.maxMegabytes ?? 200) * 1048576, expiresAt = (c.now ?? Date.now)() + DOWNLOAD_TTL_MS;
 const begun = await invoke(c, t, { action: 'download_begin', options: { downloadId, mode: a.mode, maxBytes, expiresAt, nonce, ...(a.ref !== undefined ? { ref: a.ref } : {}) }, requestKey, allowWrite: true });
 if (begun.status === 'refused') throw downloadRefusal(begun.reason);
 const claim = JSON.stringify({ purpose: DOWNLOAD_PURPOSE, version: 1, workspace_id: t.record.worker, binding: nativeBindingHash(t.record.binding), mode: a.mode, maxBytes, expiresAt, downloadId, nonce });
 return { ...begun, ...oneTimeAddress(c, t.record.job, 'd', claim, signNativeDownloadClaim(claim, claimEnv(c, t.record.job))) };
}
const downloadStatus = (c, t, response) => invoke(c, t, { action: 'download_status', options: { downloadId: String(response.download_id ?? '').slice(3) } });
// Compact clients drop large `result` objects; the one-time command (which carries the URL) and the
// allowlist note must stay visible, within the 1200-byte progress bound (optional fields go first).
const downloadEssentials = shaped => shaped?.command
 ? fitDigest({ ...(shaped.workspace_id ? { workspace_id: shaped.workspace_id } : {}), download_id: shaped.download_id, command: shaped.command, head: shaped.head ?? null, single_use: true, if_blocked: shaped.if_blocked, next: 'Run within 10 minutes; it works once. Do not publish the URL.' }, ['next', 'head', 'workspace_id', 'download_id', 'single_use'])
 : shaped?.next ? fitDigest({ ...(shaped.workspace_id ? { workspace_id: shaped.workspace_id, state: shaped.state } : {}), next: shaped.next }) : null;
const presentDownload = (a, after, response) => {
 if (typeof response?.url !== 'string') return { ...after, next: 'The download address is shown only once. Begin a new download with a fresh requestKey if you no longer have it.' };
 return { ...after, url: response.url, command: DOWNLOAD_COMMAND[a.mode](response.url), single_use: true, if_blocked: blockedNote(response.url),
  next: a.mode === 'git'
   ? 'Run the command within 10 minutes (one clone or fetch session). The clone\'s origin is the one-time URL; send changes back with github_git_workspace_upload. Do not publish the URL; it holds no GitHub credential.'
   : 'Run the command within 10 minutes (it works once). The archive has no .git folder. Do not publish the URL; it holds no GitHub credential.' };
};
const BLOCKED_GUIDANCE = 'The URL is on this service\'s own domain, the same for every repository and transfer: if the sandbox cannot reach it (host not allowed, proxy 403, DNS error), add that one domain once to the AI\'s network allowlist (for Claude: the Capabilities / network access allowed-domains setting) and ask for a new link; nothing is lost.';
const download = defineGithubWrite({
 name: 'github_git_workspace_download', area: 'git', audience: ['B', 'O', 'Op'],
 description: 'Get a whole native workspace at once: returns a one-time git clone URL, or a curl URL for a .tar.gz of a ref or the current worktree.',
 guidance: 'Instead of reading many files one at a time; for a repository you have not opened yet, github_repo_download does it in one call. mode git returns `git clone "<url>" repo` (local branches and tags, or only ref); mode archive returns a curl command for a .tar.gz of ref (branch, tag or commit; default HEAD) or of ref "worktree" (tracked plus untracked, not ignored, files; never .git). Works for workspaces attached to a Playground runtime too (served from the runtime\'s copy). The URL works for one clone session or one download within 10 minutes and holds no GitHub credential. The clone\'s origin is that one-time URL: send changes back with github_git_workspace_upload. ' + BLOCKED_GUIDANCE + ' Do not publish the URL.',
 properties: { workspace_id: WORKSPACE, mode: { type: 'string', enum: ['git', 'archive'], description: 'git = one git clone/fetch session; archive = one .tar.gz download.' },
  ref: { ...TEXT, description: 'Branch, tag or commit to serve (default: git all local branches and tags; archive HEAD). archive also accepts "worktree" for uncommitted files.' },
  maxMegabytes: { type: 'integer', minimum: 1, maximum: 500, description: 'Size cap in MiB for what is sent (default 200).' } },
 required: ['workspace_id', 'mode'], declarations,
 explain: error => error?.safeMessage ? error.message : 'The native download could not be confirmed. Inspect workspace state and the same intent receipt before retrying.',
 classifyError: error => [400, 401, 404, 409, 422, 429].includes(error?.status) ? 'rejected' : 'uncertain',
 target, read: async (a, c, t) => { configured(c); downloadArgs(a); await downloadPreflight(c, t.record); return await invoke(c, t, { action: 'inspect' }); },
 classify: () => ({}), price: () => 0,
 summarize: ({ args: a, target: t }) => `Prepare a one-time ${a.mode} download of ${a.ref ?? (a.mode === 'git' ? 'all local branches and tags' : 'HEAD')} from the native workspace for ${t.owner}/${t.repo} (read-only; the workspace is not changed)`,
 apply: ({ args: a, ctx: c, target: t, requestKey }) => beginDownload(c, t, a, requestKey),
 readAfter: async ({ ctx: c, target: t, response }) => ({ ...await downloadStatus(c, t, response), address_shown_once: true }),
 verify: ({ args: a, after, response }) => after.state === 'awaiting' && after.download_id === response.download_id && after.mode === a.mode && typeof response.url === 'string',
 essentials: downloadEssentials,
 present: ({ args: a, after, response }) => presentDownload(a, after, response)
});
// SINGLE-DOMAIN-1: the common compound — "give me this repository" in one call. It reuses an open
// workspace of the same repository on this connection (unless fresh), or clones a Git-only one
// (no runtime), then issues the same one-time download as github_git_workspace_download.
async function reusableWorkspace(c, t) {
 let after = null, best = null;
 for (let page = 0; page < 5; page++) {
  const rows = await c.db.listNativeGitWorkspaces(nativeConnection(c), { after, limit: 20 });
  for (const row of rows.slice(0, 20)) if (`${row.owner}/${row.repo}`.toLowerCase() === `${t.owner}/${t.repo}`.toLowerCase() && (!best || new Date(row.expires_at) > new Date(best.expires_at))) best = row;
  if (rows.length <= 20) break; after = rows[19].id;
 }
 return best?.id ?? null;
}
const branchOf = ref => ref === undefined || ref === 'worktree' || /^[a-f0-9]{7,64}$/.test(ref) ? undefined : ref;
const repoDownload = defineGithubWrite({
 name: 'github_repo_download', area: 'git', audience: ['B', 'O', 'Op'],
 description: 'Download a whole repository in one call: returns a one-time git clone or curl .tar.gz command on this service\'s own domain. No GitHub key in it.',
 guidance: 'The usual way to get a repository\'s files into your sandbox. mode git (default) returns `git clone "<url>" repo`; mode archive returns a curl command for a .tar.gz of ref (default HEAD; "worktree" includes uncommitted workspace files). It reuses an open native workspace of the same repository on this connection (its current commits, which may include work not yet pushed) or clones a Git-only one from GitHub (fresh: true always clones). A large repository may still be cloning: then the result says so; call again in a minute and it reuses that workspace. The URL works once within 10 minutes. ' + BLOCKED_GUIDANCE + ' To send changes back use github_git_workspace_upload with the returned workspace_id. Do not publish the URL.',
 properties: { owner: OWNER, repo: REPO, mode: { type: 'string', enum: ['git', 'archive'], description: 'git (default) = one git clone; archive = one .tar.gz.' },
  ref: { ...TEXT, description: 'Branch, tag or commit (default: git every branch and tag; archive HEAD).' }, fresh: { ...BOOL, description: 'Always clone a new copy from GitHub.' },
  maxMegabytes: { type: 'integer', minimum: 1, maximum: 500, description: 'Size cap in MiB (default 200).' } },
 required: ['repo'], declarations,
 explain: error => error?.safeMessage ? error.message : 'The repository download could not be confirmed. Call github_git_workspace_list to find the workspace before retrying.',
 classifyError: error => [400, 401, 404, 409, 422, 429].includes(error?.status) ? 'rejected' : 'uncertain',
 target: (a, c) => ({ owner: a.owner ?? c.connection.default_account, repo: a.repo, scope: 'repo', kind: 'native-git' }),
 read: async (a, c, t) => { configured(c); downloadArgs({ ...a, mode: a.mode ?? 'git' }); await authorizeNativeRepo(c, t.owner, t.repo);
  const reuse = a.fresh ? null : await reusableWorkspace(c, t);
  if (!reuse) await admitClone(c, { download: true });
  return { reuse }; },
 classify: () => ({}), price: () => 0,
 summarize: ({ args: a, target: t, before }) => `${before?.reuse ? 'Reuse the open native workspace' : 'Clone a Git-only native workspace'} for ${t.owner}/${t.repo} and prepare a one-time ${a.mode ?? 'git'} download (read-only on GitHub)`,
 apply: async ({ args: a, ctx: c, target: t, requestKey, before }) => {
  const mode = a.mode ?? 'git';
  let id = before?.reuse ?? null, record = null, reused = false;
  if (id) {
   try { record = await nativeRecord(c, id); await downloadPreflight(c, record); reused = true; }
   catch { id = null; record = null; } // e.g. an attached runtime on an older image: clone a Git-only copy instead.
   if (reused) { const state = await callNativeWorker(c, { action: 'inspect', binding: record.binding, job: record.job, workspace_id: record.worker }); if (state.state !== 'ready') return { workspace_id: id, reused, state: state.state ?? 'uncertain' }; }
  }
  if (!id) {
   if (before?.reuse) await admitClone(c, { download: true });
   const opened = await openWorkspace(c, t, { branch: branchOf(a.ref), leaseMinutes: 60 }, requestKey);
   id = opened.workspace_id;
   if (opened.result.state !== 'ready') return { workspace_id: id, reused, state: opened.result.state ?? 'uncertain' };
   record = await nativeRecord(c, id);
  }
  const begun = await beginDownload(c, { ...t, record }, { ...a, mode }, requestKey);
  return { workspace_id: id, reused, ...begun };
 },
 readAfter: async ({ ctx: c, target: t, response }) => {
  const record = await nativeRecord(c, response.workspace_id), tt = { ...t, record };
  if (typeof response.url !== 'string') return { workspace_id: response.workspace_id, reused: response.reused, ...await callNativeWorker(c, { action: 'inspect', binding: record.binding, job: record.job, workspace_id: record.worker }) };
  return { workspace_id: response.workspace_id, reused: response.reused, ...await downloadStatus(c, tt, response), address_shown_once: true };
 },
 verify: ({ args: a, after, response }) => typeof response.url === 'string'
  ? after.state === 'awaiting' && after.download_id === response.download_id && after.mode === (a.mode ?? 'git')
  : after.state === 'opening' && response.state === 'opening',
 essentials: downloadEssentials,
 present: ({ args: a, after, response }) => typeof response?.url === 'string'
  ? presentDownload({ ...a, mode: a.mode ?? 'git' }, after, response)
  : response?.workspace_id && after?.state === 'opening'
   ? { workspace_id: response.workspace_id, state: 'opening', next: 'The repository is still cloning on the worker. Call github_repo_download again in a minute (a new call, same repository); it reuses this workspace.' }
   : presentDownload({ ...a, mode: a.mode ?? 'git' }, after, response)
});
export const tools = [open.tool, read.tool, run.tool, close.tool, list.tool, upload.tool, download.tool, repoDownload.tool];
// NATIVE-ERGO-1: shared with github_repo_change (src/tools/repo-change.js); not tools themselves.
export const nativeInternals = Object.freeze({ configured, safe, admitClone, openWorkspace, reusableWorkspace, beginUpload, uploadPreflight, UPLOAD_COMMAND, uploadCommands, blockedNote, workerFeatures });
async function openWithCurrentState(args,ctx) {
 const result=await open.handler(args,ctx), value=result.structuredContent;
 if (!value?.replayed || !value.result?.workspace_id) return result;
 const id=value.result.workspace_id;
 let current={workspace_id:id,state:'unavailable',available:false,next:'The original clone receipt is historical. Inspect the old workspace if available; use a new requestKey only for a separate new workspace.'};
 try {
  const row=await ctx.db.getJob(id,nativeConnection(ctx));
  if (row?.kind==='native-git-workspace' && row.state==='ready' && row.detail==='Native workspace disposed.') current={...current,state:'disposed',next:'This workspace was closed. Use a fresh requestKey to open a new workspace; do not reuse the disposed ID.'};
  else if (row?.state==='pending') { const record=await nativeRecord(ctx,id);const observed=await callNativeWorker(ctx,{binding:record.binding,job:record.job,workspace_id:record.worker,action:'inspect'});current={workspace_id:id,...observed,available:observed.state==='ready'}; }
 } catch { /* Preserve the immutable old receipt; never turn a failed current read into availability. */ }
 const body={...value,done:value.done&&current.available,historical:true,current_workspace:current,...(!current.available?{warning:current.next}: {})};
 return {...result,structuredContent:body,content:[{type:'text',text:JSON.stringify(body)}]};
}
export const handlers = Object.fromEntries([open, read, run, close, list, upload, download, repoDownload].map(t => [t.tool.name, t===open?openWithCurrentState:t===run?runWithShortcuts:t.handler]));
