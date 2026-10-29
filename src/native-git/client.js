import {loadScannerPolicy} from '../github/scanner-policy.js';
import { createHash } from 'node:crypto';
import { githubFor, credentialFor, requestKey } from '../github/client.js';
import { WORKER_PROTOCOL, workerUrl } from './protocol.js';
import { signNativeWorkerBody } from './signing.js';
import { redactExcerpt } from '../github/content-protection.js';
import { explainGithubError } from '../tools/errors.js';
import { isOwnerConnection } from '../core/authority.js';
export const nativeConnection = ctx => {
 if (!ctx.connection?.client_id && !ctx.connection?.pass_id) throw new TypeError('A service-issued connection is required for native Git.');
 return createHash('sha256').update(JSON.stringify([ctx.connection.client_id ?? null, ctx.connection.pass_id ?? null])).digest('hex');
};
// Clone intents survive time buckets. Existing receipts are recovered only after
// checking the original job's full client/pass binding; missing history never clones.
export async function nativeOpenRequestKey(ctx, args) {
 const owner = args.owner ?? ctx.connection.default_account;
 const repo = `${owner}/${args.repo}`;
 const prefix = requestKey(ctx, 'github_git_workspace_open', args).replace(/_[0-9]+$/, '_');
 const legacy = await ctx.db.findNativeOpenChange({ account: owner, repo, connection: ctx.connection.client_id ?? null, prefix });
 if (legacy) {
  const row = legacy.after?.workspace_id ? await ctx.db.getJob(legacy.after.workspace_id, nativeConnection(ctx)) : null;
  if (!row || row.kind !== 'native-git-workspace' || `${row.owner}/${row.repo}`.toLowerCase() !== repo.toLowerCase())
   throw Object.assign(new TypeError('The original clone intent has historical or unavailable ownership metadata. Nothing was cloned. Inspect the original receipt; use a fresh requestKey only for a separate new workspace.'), {safeMessage:true});
  return legacy.requestKey;
 }
 const digest = createHash('sha256').update(JSON.stringify([nativeConnection(ctx),repo.toLowerCase(),prefix])).digest('hex');
 return `rmcp_native_open_${digest}_0`;
}
export async function authorizeNativeRepo(ctx, owner, repo) {
 const gh = await githubFor(ctx, { owner, ...(!isOwnerConnection(ctx.connection) ? { scope: { repositories: [repo] } } : {}) });
 let result; try { result = await gh.request('GET /repos/{owner}/{repo}', { owner, repo }); } catch (error) { throw new TypeError(explainGithubError(error)); }
 if (result.data?.full_name?.toLowerCase() !== `${owner}/${repo}`.toLowerCase()) throw new TypeError('GitHub did not confirm the exact workspace repository.');
 return result.data;
}
export async function nativeRecord(ctx, id, { allowDisposed = false } = {}) {
 const row = await ctx.db.getJob(id, nativeConnection(ctx));
 if (!row || row.kind !== 'native-git-workspace' || (row.state !== 'pending' && !(allowDisposed && row.state === 'ready' && row.detail === 'Native workspace disposed.'))) throw new TypeError('No active workspace belongs to this connection.');
 const meta = JSON.parse(row.provider_ref);
 if (!/^git_[a-f0-9]{32}$/.test(meta.worker ?? '') || !/^[a-f0-9]{32}$/.test(meta.authority ?? '')) throw new TypeError('Invalid stored workspace identity.');
 await authorizeNativeRepo(ctx, row.owner, row.repo);
 return { row, binding: { authority: meta.authority, connection: nativeConnection(ctx), owner: row.owner, repo: row.repo }, worker: meta.worker };
}
export async function callNativeWorker(ctx, { binding, action, workspace_id, operation, options, requestKey, expectedGeneration, allowWrite = false, network = false }) {
 const url = workerUrl(ctx.env);
 const scannerPolicy=binding?await loadScannerPolicy(ctx.db,binding.owner,binding.repo):null;
 let credential;
 if (network) {
  const result = await credentialFor(ctx, { owner: binding.owner, ...(!isOwnerConnection(ctx.connection) ? { scope: { repositories: [binding.repo] } } : {}) });
  credential = result.personal?.token ?? result.token;
  if (typeof credential !== 'string' || !credential) throw new TypeError('GitHub network authorization is unavailable.');
 }
 const body = JSON.stringify({ version: WORKER_PROTOCOL, expiresAt: (ctx.now ?? Date.now)() + 60000, binding, action, workspace_id, operation, options, requestKey, expectedGeneration, allowWrite, ...(scannerPolicy?{scannerPolicy:{settings:scannerPolicy.settings,revision:scannerPolicy.revision}}:{}), ...(credential ? { credential } : {}) });
 const failure = (code, message, status) => Object.assign(new TypeError(message), {
  safeMessage: true, nativeCode: code,safeCode:code,safeRetryable:code==='native_busy', ...(status ? { status } : {})
 });
 let response;
 try {
  response = await (ctx.fetch ?? globalThis.fetch)(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(50000), headers: { 'Content-Type': 'application/json', 'x-robinson-signature': signNativeWorkerBody(body, ctx.env) }, body });
 } catch {
  throw failure('native_transport', 'Native Git worker could not be reached. Inspect workspace state and the same intent receipt before retrying; the outcome may be unknown.');
 }
 let content;
 try {
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
   for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.length;
    if (size > 3 * 1024 * 1024) { await reader.cancel(); throw new Error('oversize'); }
    chunks.push(Buffer.from(value));
   }
  } finally { reader.releaseLock(); }
  content = Buffer.concat(chunks).toString('utf8');
 } catch {
  throw failure('native_response', 'Native Git worker response was incomplete or exceeded its result limit. Inspect workspace state and the same intent receipt before retrying.');
 }
 let data;
 try { data = JSON.parse(content); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('shape'); }
 catch { throw failure('native_response', 'Native Git worker returned an invalid response. Inspect workspace state and the same intent receipt before retrying.'); }
 if (!response.ok) {
  const busy = response.status === 409 || response.status === 429;
  // Worker reasons contain only controlled TypeErrors. Redact again at this boundary,
  // including absolute host paths; never reflect bodies, stderr or network exceptions.
  const reason = typeof data.reason === 'string'
   ? redactExcerpt(data.reason).replace(/(?:\/[A-Za-z0-9_.-]+){2,}/g, '[host path]').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 160) : '';
  throw failure(busy ? 'native_busy' : 'native_http', busy
   ? 'Native Git worker is busy. After the active operation finishes, inspect state and retry the same intent.'
   : `Native Git worker returned HTTP ${response.status}${reason ? ': ' + reason : '.'} Inspect state before a new intent.`, response.status);
 }
 return data;
}
