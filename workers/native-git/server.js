import {withProtectionContext,withRepositoryProtection} from '../../src/github/content-protection.js';
import {scannerSettings,defaultScannerSettings} from '../../src/github/scanner-policy.js';
// One process per persistent volume; calls serialize per workspace, including reads.
// Independent workspaces run up to the configured bounded capacity.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { redactExcerpt } from '../../src/github/content-protection.js';
import { NativeGitWorker, READ_OPERATIONS, WRITE_OPERATIONS } from './engine.js';
import { verifyWorkerBody, workerKey, nativeWorkspaceId, WORKER_PROTOCOL } from '../../src/native-git/protocol.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function nativeGitServer({ root, key, now = Date.now, allowLocalFixtures = false, fixtureRemote, maxConcurrent = 2 } = {}) {
 workerKey(key); if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 32) throw new TypeError('Worker capacity must be 1–32 concurrent workspaces.'); const busy = new Set();
 const server = createServer({ requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 8192 }, async (req, res) => withProtectionContext(async () => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json');
  const send = (status, data) => { res.statusCode = status; res.end(JSON.stringify(data)); };
  if (req.method === 'GET' && req.url === '/health') return send(200, { service: 'robinson-native-git', protocol: WORKER_PROTOCOL });
  if (req.method !== 'POST' || req.url !== '/v1/workspace') return send(404, { error: 'not_found' });
  let claim, lockKey, acquired = false;
  try {
   const chunks = []; let bytes = 0;
   for await (const chunk of req) { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) return send(413, { error: 'request_too_large' }); chunks.push(chunk); }
   claim = verifyWorkerBody(Buffer.concat(chunks).toString('utf8'), req.headers['x-robinson-signature'], key, now());
   if (claim.action === 'capabilities') return send(200, { ready: true, protocol: WORKER_PROTOCOL, native_git: execFileSync('git', ['--version'], { encoding: 'utf8', timeout: 2000 }).trim(), max_concurrent: maxConcurrent, workspace_lease: 'idle-v1' });
   if(!claim.scannerPolicy||!Number.isSafeInteger(claim.scannerPolicy.revision)||claim.scannerPolicy.revision<0)throw new TypeError('Protocol 2 requires the current repository scanner policy; update the control plane and worker together.');
   const policy=scannerSettings(claim.scannerPolicy?.settings??defaultScannerSettings());
   return await withRepositoryProtection(policy.additionalRules.filter(r=>!policy.disabledRules.includes(r.id)),async()=>{
   const expected = JSON.stringify(claim.binding);
   lockKey = claim.workspace_id ?? nativeWorkspaceId(claim.binding, claim.requestKey);
   if (busy.has(lockKey)) return send(409, { error: 'workspace_busy', next: 'Inspect after the current operation finishes; do not replay a mutation with a new intent.' });
   if (busy.size >= maxConcurrent) { res.setHeader('Retry-After', '2'); return send(429, { error: 'worker_capacity', next: 'Inspect then retry the same intent after capacity is available.' }); }
   busy.add(lockKey); acquired = true;
   const worker = new NativeGitWorker({ root, allowLocalFixtures, now, scannerPolicy:{settings:policy,revision:claim.scannerPolicy?.revision??0},
    authorize: async (binding, { write }) => JSON.stringify(binding) === expected && claim.expiresAt > now() && (!write || claim.allowWrite === true),
    credential: async () => { if (typeof claim.credential !== 'string' || !claim.credential) throw new TypeError('Missing short-lived network authorization.'); return claim.credential; }
   });
   if (['open','run','close'].includes(claim.action) && claim.allowWrite !== true) throw new TypeError('Workspace mutation requires an authorized write lease.');
   const sliding = claim.version === 3 && claim.action !== 'close' && !(claim.action === 'inspect' && claim.renewLease === false);
   if (sliding && (!Number.isSafeInteger(claim.idleTimeoutMs) || claim.idleTimeoutMs < 60000 || claim.idleTimeoutMs > 86400000)) throw new TypeError('Invalid workspace idle timeout.');
   if (sliding && claim.action === 'open' && claim.options?.ttlMs !== claim.idleTimeoutMs) throw new TypeError('Clone idle timeout must match its signed lease.');
   if (sliding && claim.action !== 'open') await worker.touch(claim.workspace_id, claim.binding, claim.idleTimeoutMs);
   let result;
   switch (claim.action) {
    case 'open': if (claim.allowWrite !== true) throw new TypeError('Workspace creation requires an authorized cache lease.'); result = await worker.create(claim.binding, { ...claim.options, requestKey: claim.requestKey, ...(allowLocalFixtures && fixtureRemote ? { fixtureRemote: fixtureRemote(claim.binding) } : {}) }); break;
    case 'inspect': result = await worker.inspect(claim.workspace_id, claim.binding, claim.options?.worktree); break;
    case 'read': case 'run': if (!(claim.action === 'read' ? READ_OPERATIONS : WRITE_OPERATIONS).includes(claim.operation)) throw new TypeError('Operation does not match its lease action.'); result = await worker.execute(claim.workspace_id, claim.binding, { operation: claim.operation, args: claim.options ?? {}, requestKey: claim.requestKey, expectedGeneration: claim.expectedGeneration }); break;
    case 'close': result = await worker.close(claim.workspace_id, claim.binding); break;
   }
   if (sliding) {
    const lease = await worker.touch(lockKey, claim.binding, claim.idleTimeoutMs, { admitted: true });
    result = { ...result, ...lease };
   }
   return send(200, result);
   });
  } catch (error) {
   // No raw request, credentials, signature, Git stderr or host path leaves an error.
   return send(claim ? error?.code === 'ENOENT' ? 404 : error instanceof TypeError ? 400 : 500 : 401, { error: claim ? 'operation_not_completed' : 'invalid_worker_lease', ...(claim && error instanceof TypeError ? { reason: redactExcerpt(error.message).slice(0, 600) } : {}), next: claim ? 'Inspect workspace state before a new intent. See the operation/lease guidance in docs/NATIVE-GIT-OPERATIONS.md.' : 'Obtain a fresh signed control-plane lease.' });
  } finally { if (acquired) busy.delete(lockKey); }
 }));
 server.maxConnections = 32;
 const maintenance = new NativeGitWorker({ root, authorize: async () => false, now });
 const timer = setInterval(() => maintenance.prune({ skip: busy }).catch(() => process.stderr.write('Native Git cleanup failed; inspect storage permissions and capacity.\n')), 60000); timer.unref();
 server.on('close', () => clearInterval(timer));
 return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 const root = process.env.NATIVE_GIT_STORAGE_ROOT;
 if (!root) throw new TypeError('Set NATIVE_GIT_STORAGE_ROOT to the mounted persistent volume.');
 nativeGitServer({ root, key: process.env.NATIVE_GIT_CONTROL_PUBLIC_KEY ?? process.env.NATIVE_GIT_WORKER_KEY, maxConcurrent: Number(process.env.NATIVE_GIT_MAX_CONCURRENT ?? 2) }).listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}
