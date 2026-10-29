import {loadScannerPolicy} from '../github/scanner-policy.js';
import { createHash } from 'node:crypto';
import { githubFor, credentialFor } from '../github/client.js';
import { WORKER_PROTOCOL, workerUrl } from './protocol.js';
import { signNativeWorkerBody } from './signing.js';
import { redactExcerpt } from '../github/content-protection.js';
import { explainGithubError } from '../tools/errors.js';
import { isOwnerConnection } from '../core/authority.js';
export const nativeConnection = ctx => {
 if (!ctx.connection?.client_id && !ctx.connection?.pass_id) throw new TypeError('A service-issued connection is required for native Git.');
 return createHash('sha256').update(JSON.stringify([ctx.connection.client_id ?? null, ctx.connection.pass_id ?? null])).digest('hex');
};
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
 let response; try { response = await (ctx.fetch ?? globalThis.fetch)(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(50000), headers: { 'Content-Type': 'application/json', 'x-robinson-signature': signNativeWorkerBody(body, ctx.env) }, body }); } catch { throw Object.assign(new TypeError('Native Git worker could not be reached. Inspect workspace status before a new intent; do not assume the workspace was closed.'),{safeMessage:true}); }
 const reader = response.body.getReader(); const chunks = []; let size = 0;
 try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 3 * 1024 * 1024) { await reader.cancel(); throw new TypeError('Worker response exceeds the complete result limit.'); } chunks.push(Buffer.from(value)); } } finally { reader.releaseLock(); }
 const content = Buffer.concat(chunks).toString('utf8');
 let data; try { data = JSON.parse(content); } catch { throw new TypeError('Native Git worker returned invalid JSON; inspect the workspace before another intent.'); }
 if (!response.ok) throw Object.assign(new TypeError(response.status === 409 || response.status === 429 ? 'Workspace is busy; inspect after its operation finishes and retry the same intent.' : `Native Git worker returned HTTP ${response.status}: ${typeof data.reason === 'string' ? redactExcerpt(data.reason).slice(0,200) : 'inspect workspace state before another intent.'}`), { status: response.status, safeMessage: true });
 return data;
}
