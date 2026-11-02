import {passRefusal} from '../rtc/pass-scope.js';
import {enqueueAllocation,disposeAllocation} from '../playground/allocations.js';
import {RUNTIME_CHOICES} from '../playground/sizing.js';
import { nativeWorkerPublicKey, signNativeUploadClaim, signNativeDownloadClaim } from '../native-git/signing.js';
import { randomBytes } from 'node:crypto';
import { defineRead } from './define-read.js';
import { defineGithubWrite, explainGithubError } from './define-github-write.js';
import { TenantCapacityError } from '../tenancy/runtime-limits.js';
import { READ_OPERATIONS, WRITE_OPERATIONS, gitCommand, switchBranch, branchName, nativeOperationHelp } from '../native-git/commands.js';
import { nativeWorkspaceId, workerUrl, workerKey, nativeWorkerHost, nativeWorkerRoute, nativeBindingHash, UPLOAD_PURPOSE, UPLOAD_TTL_MS, DOWNLOAD_PURPOSE, DOWNLOAD_TTL_MS } from '../native-git/protocol.js';
import { nativeConnection, nativeOpenRequestKey, nativeRecord, authorizeNativeRepo, callNativeWorker } from '../native-git/client.js';

const OWNER = { type: 'string', minLength: 1, maxLength: 39, pattern: '^[A-Za-z0-9-]+$' };
const REPO = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9_.-]+$' };
const WORKSPACE = { type: 'string', pattern: '^job_[a-f0-9]{16}$' };
const TEXT = { type: 'string', minLength: 1, maxLength: 256 };
const BOOL = { type: 'boolean' };
const OPTIONS = { type: 'object', additionalProperties: false, properties: {
 intentKey: { type: 'string', minLength: 1, maxLength: 128 }, worktree: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,60}$' }, ref: TEXT, branch: { ...TEXT, description: 'Branch name; branch_create/rename/delete accept name as alias; switch also accepts ref.' }, name: TEXT, path: { type: 'string', maxLength: 4096 }, paths: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 4096 } },
 message: { type: 'string', minLength: 1, maxLength: 10000 }, base64: { type: 'string', maxLength: 1400000 },
 expectedHead: { type: 'string', pattern: '^([a-f0-9]{40,64})?$' }, expectedFileHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
 force: BOOL, delete: BOOL, tag: BOOL, hard: BOOL, staged: BOOL, amend: BOOL, good: TEXT, bad: TEXT,
 byteOffset: { type: 'integer', minimum: 0 }, byteLength: { type: 'integer', minimum: 1, maximum: 32768 }, max: { type: 'integer', minimum: 1, maximum: 100 }
} };
const declarations = { production: 'never', confirm: 'when-needed', profiles: ['full'] };
const target = async (a, c, allowDisposed = false) => { const r = await nativeRecord(c, a.workspace_id, { allowDisposed }); return { owner: r.row.owner, repo: r.row.repo, scope: 'repo', kind: 'native-git', record: r }; };
const invoke = (c, t, a) => callNativeWorker(c, { binding: t.record.binding, job: t.record.job, workspace_id: t.record.worker, ...a });
const configured = c => { workerUrl(c.env); if (c.env?.NATIVE_GIT_WORKER_KEY) workerKey(c.env.NATIVE_GIT_WORKER_KEY); else nativeWorkerPublicKey(c.env); };

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
  const cap=await callNativeWorker(c,{action:'capabilities'});if(cap.capacity_mode!=='resource-aware')throw Object.assign(new TypeError('Update the native Git worker to resource-based admission before opening a new workspace.'),{safeMessage:true,safeCode:'native_worker_update_required'});if(!cap.admission?.allowed)throw Object.assign(new TypeError(`Native Git worker resource pressure: ${typeof cap.admission?.reason==='string'?cap.admission.reason.replace(/[^a-z_]/g,'').slice(0,64):'resource_observation_unavailable'}. No clone was sent.`),{safeMessage:true,safeCode:'native_resource_pressure',safeRetryable:true});return {}; },
 classify: () => ({}), summarize: ({ target: t }) => `Clone ${t.owner}/${t.repo} into a private native Git workspace; worker compute and storage use the configured host.`,
 apply: async ({ args: a, ctx: c, target: t, requestKey }) => {
  const id = 'job_' + randomBytes(8).toString('hex');
  const binding = { authority: randomBytes(16).toString('hex'), connection: nativeConnection(c), owner: t.owner, repo: t.repo };
  const worker = nativeWorkspaceId(binding, requestKey);
  const host = nativeWorkerHost(c.env);
  await c.db.createJob({ id, connection: nativeConnection(c), owner: t.owner, repo: t.repo, kind: 'native-git-workspace', providerRef: JSON.stringify({ authority: binding.authority, worker, host, idleTimeoutMs: (a.leaseMinutes ?? 240) * 60000 }), ttlMinutes: a.leaseMinutes ?? 240 }).catch(error=>{
   if(error instanceof TenantCapacityError) throw Object.assign(new TypeError('Active workspace capacity was reached before any clone was sent. Close a finished workspace or wait for idle cleanup, then start a new clone intent. There is no daily job-creation quota.'),{status:429,safeMessage:true,safeRetryable:true});
   throw error;
  });
  try {const result=await callNativeWorker(c, { action: 'open', binding, job: {id,host,idleTimeoutMs:(a.leaseMinutes ?? 240)*60000}, requestKey, allowWrite: true, network: true, options: { branch: a.branch, depth: a.depth, authorName: a.authorName, authorEmail: a.authorEmail, ttlMs: (a.leaseMinutes ?? 240) * 60000 } });let playground={phase:'git_only',reason:'provider_setup_required'};
   if(result.state==='opening')playground={phase:'git_only',reason:'clone_in_progress',next:'When the clone is ready, provision a runtime with github_playground_workspace operation provision if commands are needed.'};
   else if(result.state==='ready'&&a.runtime==='none')playground={phase:'git_only',reason:'runtime_not_requested',next:'Provision later with github_playground_workspace operation provision and a size if commands are needed.'};
   else if(result.state==='ready'&&!passRefusal({tool:{name:'github_playground_workspace',area:'playground',writes:true,inputSchema:{properties:{repo:{}}}},args:{owner:t.owner,repo:t.repo},connection:c.connection})){try{const allocated=await enqueueAllocation(c,await nativeRecord(c,id),{size:a.runtime});playground=!allocated?{phase:'git_only',reason:'no_runtime_host',next:'No ready computer of yours and no shared runtime pool is available. Add your own computer or server from My connection to run commands.'}:{placement:allocated.placement??'operator_pool',phase:allocated.phase,workspace_id:id,runtime_size:allocated.size??null,next:'Allocation manager will provision and attach this workspace; read Playground allocation for progress.'};}catch{playground={phase:'git_only',reason:'allocation_recovery_required',next:'Git work is preserved; inspect Playground allocation with this same workspace ID.'};}}
   return {workspace_id:id,result,playground};}
  catch(error) {if(error.nativeNoOperationStarted){await c.db.finishJob(id,nativeConnection(c),{state:'failed',detail:'Worker resource admission declined before clone.'});throw error;}return { workspace_id: id, result: { state: 'uncertain' } }; }
 },
 readAfter: async ({ ctx: c, response }) => {
  const record = await nativeRecord(c, response.workspace_id);
  try { return { workspace_id: response.workspace_id, playground:response.playground, ...await callNativeWorker(c, { action: 'inspect', binding: record.binding, job: record.job, workspace_id: record.worker }) }; }
  catch { return { workspace_id: response.workspace_id, state: 'uncertain', next: 'Use github_git_workspace_read status; do not open another clone to retry this intent.' }; }
 },
 verify: ({ after }) => ['ready', 'opening'].includes(after.state), present: ({ after, response }) => after?.state === 'opening' ? { ...after, next: 'Large repository: the clone continues on the worker. Read github_git_workspace_read operation status until state is ready (or failed); do not open another clone.' } : after ?? response
});
const read = defineRead({
 name: 'github_git_workspace_read', area: 'git', audience: ['B', 'O', 'Op'], byteWindow: true,
 description: 'Read native Git status, history, diffs, conflicts, refs or exact file byte windows from this connection’s workspace.',
 properties: { workspace_id: WORKSPACE, operation: { type: 'string', enum: ['capabilities', ...READ_OPERATIONS] }, options: OPTIONS, byteOffset: { type: 'integer', minimum: 0 }, byteLength: { type: 'integer', minimum: 1, maximum: 32768 } }, required: ['operation'],
 handler: async (a, c) => { if (a.operation === 'capabilities') {
  let worker; try { worker = await callNativeWorker(c, { action: 'capabilities' }); } catch { worker = { ready: false, setup_required: true }; }
  return { bulk_upload: { tool: 'github_git_workspace_upload', next: 'For more than about 1 MB of files: one-time git push or curl upload URL straight to this worker, then apply.' }, bulk_download: { tool: 'github_git_workspace_download', next: 'For the whole workspace or many files: one-time git clone or curl .tar.gz URL straight from this worker.' }, playground: {tools:['github_playground_execute','github_playground_read','github_playground_cancel'],next:'Search/describe/call these agent tools for commands, builds and tests in an attached isolated runtime. This Git worker remains typed Git only.'}, operation_help: a.options?.name ? nativeOperationHelp(a.options.name) : { next: 'Call capabilities with options.name set to an operation for exact options and an example.' }, worker, read_operations: READ_OPERATIONS, write_operations: WRITE_OPERATIONS, setup: 'https://github.com/Robinson-AI-Systems/github-mcp/blob/main/docs/NATIVE-GIT-OPERATIONS.md', unsupported: [
    { feature: 'LFS', guidance: 'Install git-lfs locally, run git lfs install in your trusted local clone, and use git lfs pull/push with your own GitHub authorization.' },
    { feature: 'submodules', guidance: 'Use a trusted isolated local clone, review .gitmodules origins, then git submodule update --init --recursive with separate repository permissions.' },
    { feature: 'executable hooks/filters, signing, custom remotes and arbitrary shell/bisect run in the Git worker', guidance: 'For commands/builds/tests, use github_playground_execute in an attached isolated Robinson Playground runtime. This Git worker stays typed Git; advanced credentialed Git configuration still uses the documented trusted local alternative.' }
   ], cost: 'The initial worker is a running container on the configured host, not scale-to-zero. Compute, persistent storage and transfer depend on that host; no zero-idle-cost claim. Portable encrypted snapshots support moving to an owned host.' };
 } if (a.operation === 'read_file' && a.byteLength === undefined) throw new TypeError('Exact file reads require byteLength (1–32768), optional byteOffset, and options.path; use the returned file_hash as options.expectedFileHash for continuation.'); const r = await nativeRecord(c, a.workspace_id); return callNativeWorker(c, { binding: r.binding, job: r.job, workspace_id: r.worker, action: a.operation === 'status' ? 'inspect' : 'read', operation: a.operation, options: { ...(a.options ?? {}), ...(a.byteOffset !== undefined ? { byteOffset: a.byteOffset } : {}), ...(a.byteLength !== undefined ? { byteLength: a.byteLength } : {}) }, network: a.operation === 'remote_refs' }); }
});
const run = defineGithubWrite({
 name: 'github_git_workspace_run', area: 'git', audience: ['B', 'O', 'Op'],
 description: 'Run typed native Git operations. Read capabilities with options.name set to the operation for exact required arguments and examples.',
 properties: { workspace_id: WORKSPACE, operation: { type: 'string', enum: WRITE_OPERATIONS }, expectedGeneration: { type: 'integer', minimum: 0 }, options: OPTIONS }, required: ['workspace_id', 'operation', 'expectedGeneration'], declarations: { ...declarations, production: 'when-target' },
 explain: error => error?.safeMessage ? error.message : 'Native Git operation could not be confirmed. Inspect workspace state and the same intent receipt before retrying.',
 classifyError: error => [401,409,429].includes(error?.status) ? 'rejected' : 'uncertain',
 target, read: async (a, c, t) => { configured(c); try { gitCommand(a.operation, a.options ?? {}); } catch (error) { throw Object.assign(new TypeError(`Native ${a.operation} arguments: ${error.message}`), { safeMessage: true,safeCode:'invalid_native_arguments' }); } try { return await invoke(c, t, { action: 'inspect', options: { worktree: a.options?.worktree } }); } catch (error) { if (error.safeMessage) error.message = `Native ${a.operation} preflight: ${error.message}`.slice(0,300); throw error; } },
 classify: ({ args: a }) => a.operation === 'push' ? { production: 'push changes exact GitHub remote refs; GitHub permissions and repository rules apply' } : {},
 price: () => 0, // Git ref transport itself does not buy seats/compute; disclose repository-automation costs separately.
 summarize: ({ args: a, target: t }) => `Native Git ${a.operation} in ${t.owner}/${t.repo} at workspace generation ${a.expectedGeneration}${a.operation === 'push' ? '; future GitHub automation costs may be unknown' : ''}`,
 apply: ({ args: a, ctx: c, target: t, requestKey }) => invoke(c, t, { action: 'run', operation: a.operation, options: a.options ?? {}, requestKey, expectedGeneration: a.expectedGeneration, allowWrite: true, network: ['fetch', 'pull', 'push'].includes(a.operation) }),
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
 verify: ({ args: a, after }) => after.operation.status === 'applied' && after.workspace.generation === after.operation.generation && (a.operation !== 'push' || after.operation.remote_verified === true) && (a.operation !== 'switch' || after.workspace.branch === switchBranch(a.options ?? {})) && (!['branch_create','branch_rename','branch_delete'].includes(a.operation) || after.reference.exists === (a.operation !== 'branch_delete')),
 present: ({ after, response }) => after ?? response
});
const close = defineGithubWrite({
 name: 'github_git_workspace_close', area: 'git', audience: ['B', 'O', 'Op'],
 description: 'Dispose this connection’s native Git workspace, including uncommitted changes; never deletes the GitHub repository.',
 properties: { workspace_id: WORKSPACE }, required: ['workspace_id'], declarations: { ...declarations, production: 'when-target' },
 explain: error => error?.safeMessage ? error.message : 'Native Git operation could not be confirmed. Inspect workspace state and the same intent receipt before retrying.',
 classifyError: error => [401,409,429].includes(error?.status) ? 'rejected' : 'uncertain', target: (a, c) => target(a, c, true),
 read: async (_a, c, t) => { try { return await invoke(c, t, { action: 'inspect', renewLease: false }); } catch (e) { if (e.status === 404) return { disposed: true }; throw e; } }, classify: () => ({}), summarize: ({ target: t }) => `Dispose native workspace for ${t.owner}/${t.repo}; uncommitted local work is deleted.`,
 apply: async ({ ctx: c, target: t, before }) => { const allocation=await disposeAllocation(c,t.record);if(allocation.disposed!==true)throw Object.assign(new TypeError('Playground cleanup is pending; native files were preserved.'),{safeMessage:true});if (before.disposed) return { disposed: true }; const result = await invoke(c, {...t,record:{...t.record,job:{...t.record.job,brokerOrigin:undefined,allocationBinding:undefined}}}, { action: 'close', allowWrite: true }); return result; },
 readAfter: async ({ args: a, ctx: c, target: t }) => {
  // The worker may briefly refuse under load right after a close; retry the readback
  // (it is read-only) before calling the outcome uncertain. 404 = the workspace is gone.
  for (let attempt = 0; ; attempt++) {
   try { await invoke(c, t, { action: 'inspect', renewLease: false }); return { state: 'pending' }; }
   catch (error) {
    if (error.status === 404) break;
    const transient = error.nativeCode === 'native_busy' || error.nativeCode === 'native_transport' || [429, 502, 503, 504].includes(error.status);
    if (!transient || attempt >= 3) throw error;
    await (c.sleep ?? (ms => new Promise(r => setTimeout(r, ms))))(500 * 2 ** attempt);
   }
  }
  return await c.db.finishJob(a.workspace_id, nativeConnection(c), { state: 'ready', detail: 'Native workspace disposed.' }) ?? c.db.getJob(a.workspace_id, nativeConnection(c));
 }, verify: ({ after }) => after?.state === 'ready' && after.detail === 'Native workspace disposed.', present: ({ after }) => ({ disposed: after?.state === 'ready' && after.detail === 'Native workspace disposed.' })
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
const UPLOAD_COMMAND = { git: url => `git push "${url}" HEAD:refs/heads/upload`, archive: url => `curl --fail --upload-file files.tar.gz "${url}"` };
const upload = defineGithubWrite({
 name: 'github_git_workspace_upload', area: 'git', audience: ['B', 'O', 'Op'],
 description: 'Move many or large files into a native workspace: begin returns a one-time git push or curl upload URL; apply checks what arrived and adds it.',
 guidance: 'For more than about 1 MB of files. begin (mode git or archive, fresh requestKey) returns a private URL that works once within 10 minutes: git mode runs `git push "<url>" HEAD:refs/heads/upload` from your own clone (commits must build on the workspace HEAD); archive mode runs `curl --fail --upload-file files.tar.gz "<url>"` (.tar.gz, .tar or .zip). Then apply with upload_id and the current expectedGeneration: git fast-forwards the workspace branch; archive extracts under optional path. Links, .git paths, oversize files and credential-shaped content are refused. Commit and push with github_git_workspace_run. Do not publish the URL.',
 properties: { workspace_id: WORKSPACE, operation: { type: 'string', enum: ['begin', 'apply'] }, mode: { type: 'string', enum: ['git', 'archive'], description: 'begin: git = receive one git push; archive = receive one .tar.gz/.tar/.zip file.' },
  maxMegabytes: { type: 'integer', minimum: 1, maximum: 100, description: 'begin: upload size cap in MiB (default 50).' }, upload_id: { type: 'string', pattern: '^upl_[a-f0-9]{32}$' },
  expectedGeneration: { type: 'integer', minimum: 0 }, ref: { ...TEXT, description: 'apply (git): pushed branch to apply when several were pushed.' }, path: { type: 'string', minLength: 1, maxLength: 1024, description: 'apply (archive): workspace subfolder to extract into (default the repository root).' } },
 required: ['workspace_id', 'operation'], declarations,
 explain: error => error?.safeMessage ? error.message : 'The native upload could not be confirmed. Inspect workspace state and the same intent receipt before retrying.',
 classifyError: error => [400, 401, 404, 409, 422, 429].includes(error?.status) ? 'rejected' : 'uncertain',
 target, read: async (a, c, t) => { configured(c);
  const wrong = (a.operation === 'begin' ? ['upload_id', 'expectedGeneration', 'ref', 'path'] : ['mode', 'maxMegabytes']).filter(k => a[k] !== undefined);
  if (wrong.length) throw Object.assign(new TypeError(`${wrong.join(', ')} ${wrong.length > 1 ? 'are' : 'is'} not used by operation ${a.operation}.`), { safeMessage: true, safeCode: 'invalid_upload_arguments' });
  if (a.operation === 'begin' && !a.mode) throw Object.assign(new TypeError('begin requires mode: git (one git push) or archive (one .tar.gz/.tar/.zip upload).'), { safeMessage: true, safeCode: 'invalid_upload_arguments' });
  if (a.operation === 'apply' && (a.upload_id === undefined || a.expectedGeneration === undefined)) throw Object.assign(new TypeError('apply requires upload_id from begin and the current expectedGeneration.'), { safeMessage: true, safeCode: 'invalid_upload_arguments' });
  if (a.operation === 'begin') {
   if (t.record.job.brokerOrigin) throw Object.assign(new TypeError('This workspace is attached to a dedicated Playground runtime; copy files there with github_playground_execute, or use write_file.'), { safeMessage: true, safeCode: 'native_upload_unavailable' });
   const cap = await callNativeWorker(c, { action: 'capabilities', job: t.record.job });
   if (cap.direct_upload !== 'quarantine-v1') throw Object.assign(new TypeError('The native Git worker must be updated before direct uploads work. Use write_file (about 1 MB per call) meanwhile.'), { safeMessage: true, safeCode: 'native_worker_update_required' });
  }
  return await invoke(c, t, { action: 'inspect' }); },
 classify: () => ({}), price: () => 0,
 summarize: ({ args: a, target: t }) => a.operation === 'begin' ? `Open a one-time ${a.mode ?? ''} upload into the native workspace for ${t.owner}/${t.repo} (quarantined until applied)` : `Apply quarantined upload ${a.upload_id} to the native workspace for ${t.owner}/${t.repo} at generation ${a.expectedGeneration}`,
 apply: async ({ args: a, ctx: c, target: t, requestKey }) => {
  if (a.operation === 'apply') {
   const result = await invoke(c, t, { action: 'upload_apply', options: { uploadId: a.upload_id.slice(4), ...(a.ref !== undefined ? { ref: a.ref } : {}), ...(a.path !== undefined ? { path: a.path } : {}) }, requestKey, expectedGeneration: a.expectedGeneration, allowWrite: true });
   if (result.status === 'refused') throw uploadRefusal(result.reason);
   return result;
  }
  const uploadId = randomBytes(16).toString('hex'), nonce = randomBytes(16).toString('hex');
  const maxBytes = (a.maxMegabytes ?? 50) * 1048576, expiresAt = (c.now ?? Date.now)() + UPLOAD_TTL_MS;
  const begun = await invoke(c, t, { action: 'upload_begin', options: { uploadId, mode: a.mode, maxBytes, expiresAt, nonce }, requestKey, allowWrite: true });
  const claim = JSON.stringify({ purpose: UPLOAD_PURPOSE, version: 1, workspace_id: t.record.worker, binding: nativeBindingHash(t.record.binding), mode: a.mode, maxBytes, expiresAt, uploadId, nonce });
  const url = `${new URL(nativeWorkerRoute(c.env, t.record.job)).origin}/v1/upload/${Buffer.from(claim).toString('base64url')}.${signNativeUploadClaim(claim, c.env)}`;
  return { ...begun, url };
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
  ? { upload_id: shaped.upload_id, command: shaped.command, single_use: true, next: shaped.next }
  : (shaped && 'generation' in shaped) || shaped?.workspace
   ? { applied: true, mode: shaped.mode, target: shaped.target, files_added: shaped.files_added, files_changed: shaped.files_changed, bytes: shaped.bytes, workspace: shaped.workspace, next: shaped.next }
   : shaped?.next ? { next: shaped.next } : null,
 present: ({ args: a, after, response }) => {
  if (a.operation === 'apply') { const { status: _status, stdout: _o, stderr: _e, ...summary } = after?.operation ?? response ?? {}; return { ...summary, workspace: after?.workspace ? { generation: after.workspace.generation, branch: after.workspace.branch, head: after.workspace.head } : undefined, next: 'Review with github_git_workspace_read (status/diff), then add, commit and push with github_git_workspace_run.' }; }
  if (typeof response?.url !== 'string') return { ...after, next: 'The upload address is shown only once. Begin a new upload with a fresh requestKey if you no longer have it.' };
  return { ...after, url: response.url, command: UPLOAD_COMMAND[a.mode](response.url), single_use: true,
   next: `Run the command within 10 minutes (it works once), then call github_git_workspace_upload operation apply with upload_id ${after.upload_id} and the current expectedGeneration. Do not publish the URL; it holds no GitHub credential.` };
 }
});
// GIT-DOWNLOAD-1: the mirror of upload. begin snapshots the workspace on the worker and returns a
// signed, ten-minute address for one read-only clone session or one archive download — never a
// GitHub or provider credential. The address is returned once (it is not stored in the change log).
const DOWNLOAD_COMMAND = { git: url => `git clone "${url}" repo`, archive: url => `curl -fsSL "${url}" -o repo.tar.gz && mkdir -p repo && tar -xzf repo.tar.gz -C repo` };
const downloadRefusal = reason => Object.assign(new TypeError(String(reason ?? 'The download was refused.').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 600)), { safeMessage: true, safeCode: 'native_download_refused', status: 422 });
const download = defineGithubWrite({
 name: 'github_git_workspace_download', area: 'git', audience: ['B', 'O', 'Op'],
 description: 'Get a whole native workspace at once: returns a one-time git clone URL, or a curl URL for a .tar.gz of a ref or the current worktree.',
 guidance: 'Instead of reading many files one at a time. mode git returns `git clone "<url>" repo` (local branches and tags, or only ref); mode archive returns a curl command for a .tar.gz of ref (branch, tag or commit; default HEAD) or of ref "worktree" (tracked plus untracked, not ignored, files; never .git). The URL works for one clone session or one download within 10 minutes and holds no GitHub credential. The clone\'s origin is that one-time URL: send changes back with github_git_workspace_upload. Do not publish the URL.',
 properties: { workspace_id: WORKSPACE, mode: { type: 'string', enum: ['git', 'archive'], description: 'git = one git clone/fetch session; archive = one .tar.gz download.' },
  ref: { ...TEXT, description: 'Branch, tag or commit to serve (default: git all local branches and tags; archive HEAD). archive also accepts "worktree" for uncommitted files.' },
  maxMegabytes: { type: 'integer', minimum: 1, maximum: 500, description: 'Size cap in MiB for what is sent (default 200).' } },
 required: ['workspace_id', 'mode'], declarations,
 explain: error => error?.safeMessage ? error.message : 'The native download could not be confirmed. Inspect workspace state and the same intent receipt before retrying.',
 classifyError: error => [400, 401, 404, 409, 422, 429].includes(error?.status) ? 'rejected' : 'uncertain',
 target, read: async (a, c, t) => { configured(c);
  if (a.mode === 'git' && a.ref === 'worktree') throw Object.assign(new TypeError('ref "worktree" is for mode archive; a git clone carries commits only. Commit first, or use mode archive.'), { safeMessage: true, safeCode: 'invalid_download_arguments' });
  if (t.record.job.brokerOrigin) throw Object.assign(new TypeError('This workspace is attached to a dedicated Playground runtime; package files there with github_playground_execute instead.'), { safeMessage: true, safeCode: 'native_download_unavailable' });
  const cap = await callNativeWorker(c, { action: 'capabilities', job: t.record.job });
  if (cap.direct_download !== 'one-time-v1') throw Object.assign(new TypeError('The native Git worker must be updated before direct downloads work. Use github_git_workspace_read read_file meanwhile.'), { safeMessage: true, safeCode: 'native_worker_update_required' });
  return await invoke(c, t, { action: 'inspect' }); },
 classify: () => ({}), price: () => 0,
 summarize: ({ args: a, target: t }) => `Prepare a one-time ${a.mode} download of ${a.ref ?? (a.mode === 'git' ? 'all local branches and tags' : 'HEAD')} from the native workspace for ${t.owner}/${t.repo} (read-only; the workspace is not changed)`,
 apply: async ({ args: a, ctx: c, target: t, requestKey }) => {
  const downloadId = randomBytes(16).toString('hex'), nonce = randomBytes(16).toString('hex');
  const maxBytes = (a.maxMegabytes ?? 200) * 1048576, expiresAt = (c.now ?? Date.now)() + DOWNLOAD_TTL_MS;
  const begun = await invoke(c, t, { action: 'download_begin', options: { downloadId, mode: a.mode, maxBytes, expiresAt, nonce, ...(a.ref !== undefined ? { ref: a.ref } : {}) }, requestKey, allowWrite: true });
  if (begun.status === 'refused') throw downloadRefusal(begun.reason);
  const claim = JSON.stringify({ purpose: DOWNLOAD_PURPOSE, version: 1, workspace_id: t.record.worker, binding: nativeBindingHash(t.record.binding), mode: a.mode, maxBytes, expiresAt, downloadId, nonce });
  const url = `${new URL(nativeWorkerRoute(c.env, t.record.job)).origin}/v1/download/${Buffer.from(claim).toString('base64url')}.${signNativeDownloadClaim(claim, c.env)}`;
  return { ...begun, url };
 },
 readAfter: async ({ ctx: c, target: t, response }) => ({ ...await invoke(c, t, { action: 'download_status', options: { downloadId: String(response.download_id ?? '').slice(3) } }), address_shown_once: true }),
 verify: ({ args: a, after, response }) => after.state === 'awaiting' && after.download_id === response.download_id && after.mode === a.mode && typeof response.url === 'string',
 // Compact clients drop large `result` objects; the one-time command (which carries the URL) must stay visible.
 essentials: shaped => shaped?.command ? { download_id: shaped.download_id, command: shaped.command, head: shaped.head ?? null, single_use: true, next: 'Run within 10 minutes; it works once. Do not publish the URL.' } : shaped?.next ? { next: shaped.next } : null,
 present: ({ args: a, after, response }) => {
  if (typeof response?.url !== 'string') return { ...after, next: 'The download address is shown only once. Begin a new download with a fresh requestKey if you no longer have it.' };
  return { ...after, url: response.url, command: DOWNLOAD_COMMAND[a.mode](response.url), single_use: true,
   next: a.mode === 'git'
    ? 'Run the command within 10 minutes (one clone or fetch session). The clone\'s origin is the one-time URL; send changes back with github_git_workspace_upload. Do not publish the URL; it holds no GitHub credential.'
    : 'Run the command within 10 minutes (it works once). The archive has no .git folder. Do not publish the URL; it holds no GitHub credential.' };
 }
});
export const tools = [open.tool, read.tool, run.tool, close.tool, list.tool, upload.tool, download.tool];
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
export const handlers = Object.fromEntries([open, read, run, close, list, upload, download].map(t => [t.tool.name, t===open?openWithCurrentState:t.handler]));
