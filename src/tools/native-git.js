import { nativeWorkerPublicKey } from '../native-git/signing.js';
import { randomBytes } from 'node:crypto';
import { defineRead } from './define-read.js';
import { defineGithubWrite, explainGithubError } from './define-github-write.js';
import { TenantCapacityError } from '../tenancy/runtime-limits.js';
import { READ_OPERATIONS, WRITE_OPERATIONS, gitCommand, switchBranch, branchName, nativeOperationHelp } from '../native-git/commands.js';
import { nativeWorkspaceId, workerUrl, workerKey, nativeWorkerHost } from '../native-git/protocol.js';
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
 properties: { owner: OWNER, repo: REPO, branch: TEXT, authorName: { type: 'string', minLength: 1, maxLength: 100 }, authorEmail: { type: 'string', minLength: 1, maxLength: 254 }, depth: { type: 'integer', minimum: 1, maximum: 100000 }, leaseMinutes: { type: 'integer', minimum: 1, maximum: 1440, description: 'Idle timeout in minutes, renewed by authorized workspace activity; default 240 (four hours).' } }, required: ['repo'], declarations,
 target: (a, c) => ({ owner: a.owner ?? c.connection.default_account, repo: a.repo, scope: 'repo', kind: 'native-git' }),
 read: async (a, c, t) => { configured(c); await authorizeNativeRepo(c, t.owner, t.repo); return {}; },
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
  try { return { workspace_id: id, result: await callNativeWorker(c, { action: 'open', binding, job: {id,host,idleTimeoutMs:(a.leaseMinutes ?? 240)*60000}, requestKey, allowWrite: true, network: true, options: { branch: a.branch, depth: a.depth, authorName: a.authorName, authorEmail: a.authorEmail, ttlMs: (a.leaseMinutes ?? 240) * 60000 } }) }; }
  catch { return { workspace_id: id, result: { state: 'uncertain' } }; }
 },
 readAfter: async ({ ctx: c, response }) => {
  const record = await nativeRecord(c, response.workspace_id);
  try { return { workspace_id: response.workspace_id, ...await callNativeWorker(c, { action: 'inspect', binding: record.binding, job: record.job, workspace_id: record.worker }) }; }
  catch { return { workspace_id: response.workspace_id, state: 'uncertain', next: 'Use github_git_workspace_read status; do not open another clone to retry this intent.' }; }
 },
 verify: ({ after }) => after.state === 'ready', present: ({ after, response }) => after ?? response
});
const read = defineRead({
 name: 'github_git_workspace_read', area: 'git', audience: ['B', 'O', 'Op'], byteWindow: true,
 description: 'Read native Git status, history, diffs, conflicts, refs or exact file byte windows from this connection’s workspace.',
 properties: { workspace_id: WORKSPACE, operation: { type: 'string', enum: ['capabilities', ...READ_OPERATIONS] }, options: OPTIONS, byteOffset: { type: 'integer', minimum: 0 }, byteLength: { type: 'integer', minimum: 1, maximum: 32768 } }, required: ['operation'],
 handler: async (a, c) => { if (a.operation === 'capabilities') {
  let worker; try { worker = await callNativeWorker(c, { action: 'capabilities' }); } catch { worker = { ready: false, setup_required: true }; }
  return { operation_help: a.options?.name ? nativeOperationHelp(a.options.name) : { next: 'Call capabilities with options.name set to an operation for exact options and an example.' }, worker, read_operations: READ_OPERATIONS, write_operations: WRITE_OPERATIONS, setup: 'https://github.com/Robinson-AI-Systems/github-mcp/blob/main/docs/NATIVE-GIT-OPERATIONS.md', unsupported: [
    { feature: 'LFS', guidance: 'Install git-lfs locally, run git lfs install in your trusted local clone, and use git lfs pull/push with your own GitHub authorization.' },
    { feature: 'submodules', guidance: 'Use a trusted isolated local clone, review .gitmodules origins, then git submodule update --init --recursive with separate repository permissions.' },
    { feature: 'executable hooks/filters, signing, custom remotes and arbitrary shell/bisect run', guidance: 'Use your local native Git configuration in an isolated environment with its own credentials. The worker never executes repository-provided programs.' }
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
 apply: async ({ ctx: c, target: t, before }) => { if (before.disposed) return { disposed: true }; const result = await invoke(c, t, { action: 'close', allowWrite: true }); return result; },
 readAfter: async ({ args: a, ctx: c, target: t }) => {
  try { await invoke(c, t, { action: 'inspect', renewLease: false }); return { state: 'pending' }; }
  catch (error) { if (error.status !== 404) throw error; }
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
export const tools = [open.tool, read.tool, run.tool, close.tool, list.tool];
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
export const handlers = Object.fromEntries([open, read, run, close, list].map(t => [t.tool.name, t===open?openWithCurrentState:t.handler]));
