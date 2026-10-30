import {repositoryMounts} from './mounts.js';
import {join} from 'node:path';
import {attachmentRequest} from './attachment.js';
import {createHash} from 'node:crypto';
import {withProtectionContext,withRepositoryProtection} from '../../src/github/content-protection.js';
import {scannerSettings,defaultScannerSettings} from '../../src/github/scanner-policy.js';
// One process per persistent volume; calls serialize per workspace, including reads.
// Independent workspaces are admitted by measured resource headroom, not a request count.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { redactExcerpt } from '../../src/github/content-protection.js';
import { NativeGitWorker, READ_OPERATIONS, WRITE_OPERATIONS } from './engine.js';
import { verifyWorkerBody, workerKey, nativeWorkspaceId, WORKER_PROTOCOL } from '../../src/native-git/protocol.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {createResourceMonitor,resourcePolicyFromEnv} from './resources.js';

export function nativeGitServer({ root, key, now = Date.now, allowLocalFixtures = false, fixtureRemote, resources, resourcePolicy = {}, singleWorkspaceId, singleBinding, authorityUrl } = {}) {
 workerKey(key); const busy = new Set();
 const monitor=resources??createResourceMonitor({root,policy:resourcePolicy});
 const gitVersion=execFileSync('git',['--version'],{encoding:'utf8',timeout:2000}).trim();
 const server = createServer({ requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 8192 }, async (req, res) => withProtectionContext(async () => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json');
  const send = (status, data) => { res.statusCode = status; res.end(JSON.stringify(data)); };
  if (req.method === 'GET' && req.url === '/health') return send(200, { service: 'robinson-native-git', protocol: WORKER_PROTOCOL });
  if(req.method==='POST'&&req.url==='/v1/authority'&&singleWorkspaceId&&authorityUrl){
   try{let body='';for await(const chunk of req){body+=chunk.toString();if(Buffer.byteLength(body)>16384)return send(413,{error:'request_too_large'});}const url=new URL(authorityUrl);if(url.protocol!=='https:'||url.username||url.password)throw new TypeError('Invalid fixed authority origin.');const answer=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','x-robinson-runtime-signature':String(req.headers['x-robinson-runtime-signature']??'')},body});let text='';for await(const chunk of answer.body){text+=Buffer.from(chunk).toString();if(Buffer.byteLength(text)>16384)throw new TypeError('Authority response is too large.');}res.statusCode=answer.status;const signature=answer.headers.get('x-robinson-signature');if(signature)res.setHeader('x-robinson-signature',signature);return res.end(text);}catch{return send(503,{error:'authority_unavailable'});}
  }
  if (req.method !== 'POST' || req.url !== '/v1/workspace') return send(404, { error: 'not_found' });
  let claim, lockKey, acquired = false;
  try {
   const chunks = []; let bytes = 0;
   for await (const chunk of req) { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) return send(413, { error: 'request_too_large' }); const admitted=monitor.body(bytes);if(!admitted.allowed){res.setHeader('Retry-After','2');return send(429,{error:'worker_resource_pressure',reason:admitted.reason,phase:'admission',no_operation_started:true});}chunks.push(chunk); }
   claim = verifyWorkerBody(Buffer.concat(chunks).toString('utf8'), req.headers['x-robinson-signature'], key, now());
   if (claim.action === 'capabilities') return send(200, { ready: true, protocol: WORKER_PROTOCOL, native_git:gitVersion,max_concurrent:null,capacity_mode:'resource-aware',resource_policy:monitor.policy,admission:await monitor.check(),workspace_lease:'idle-v1',repository_attachment:'sealed-mounted-v1',...(singleWorkspaceId?{repository:await repositoryMounts(join(root,singleWorkspaceId,'repo'))}:{}) });
   if(!claim.scannerPolicy||!Number.isSafeInteger(claim.scannerPolicy.revision)||claim.scannerPolicy.revision<0)throw new TypeError('Protocol 2 requires the current repository scanner policy; update the control plane and worker together.');
   const policy=scannerSettings(claim.scannerPolicy?.settings??defaultScannerSettings());
   return await withRepositoryProtection(policy.additionalRules.filter(r=>!policy.disabledRules.includes(r.id)),async()=>{
   if(singleWorkspaceId){const identity=createHash('sha256').update(JSON.stringify(['authority','connection','owner','repo'].map(k=>claim.binding?.[k]))).digest('hex');if(claim.workspace_id!==singleWorkspaceId||identity!==singleBinding)throw new TypeError('Dedicated Git broker binding differs.');}
   const expected = JSON.stringify(claim.binding);
   lockKey = claim.workspace_id ?? nativeWorkspaceId(claim.binding, claim.requestKey);
   if (busy.has(lockKey)) return send(409, { error: 'workspace_busy', next: 'Inspect after the current operation finishes; do not replay a mutation with a new intent.' });
   busy.add(lockKey); acquired = true;
   if(claim.action!=='close'&&!(claim.action==='inspect'&&claim.renewLease===false)){
    const needsDisk=claim.action==='open'||claim.action==='run'&&!['remove_file','clean'].includes(claim.operation);
    const admitted=await monitor.check({needsDisk});
    if(!admitted.allowed){res.setHeader('Retry-After','2');return send(429,{error:'worker_resource_pressure',reason:admitted.reason,phase:'admission',no_operation_started:true,next:'Measured worker resources are under pressure. Inspect state, then retry after resources recover.'});}
   }
   const worker = new NativeGitWorker({ root, allowLocalFixtures, now, scannerPolicy:{settings:policy,revision:claim.scannerPolicy?.revision??0},
    authorize: async (binding, { write }) => JSON.stringify(binding) === expected && claim.expiresAt > now() && (!write || claim.allowWrite === true),
    credential: async () => { if (typeof claim.credential !== 'string' || !claim.credential) throw new TypeError('Missing short-lived network authorization.'); return claim.credential; }
   });
   if (['open','run','close'].includes(claim.action) && claim.allowWrite !== true) throw new TypeError('Workspace mutation requires an authorized write lease.');
   const sliding = claim.version === 3 && !claim.action.startsWith('attachment_') && claim.action !== 'close' && !(claim.action === 'inspect' && claim.renewLease === false);
   if (sliding && (!Number.isSafeInteger(claim.idleTimeoutMs) || claim.idleTimeoutMs < 60000 || claim.idleTimeoutMs > 86400000)) throw new TypeError('Invalid workspace idle timeout.');
   if (sliding && claim.action === 'open' && claim.options?.ttlMs !== claim.idleTimeoutMs) throw new TypeError('Clone idle timeout must match its signed lease.');
   if (sliding && claim.action !== 'open') await worker.touch(claim.workspace_id, claim.binding, claim.idleTimeoutMs);
   let result;
   switch (claim.action) {
    case 'attachment_export':case 'attachment_import':result=await attachmentRequest(worker,claim,{singleWorkspaceId});break;
    case 'open': if (claim.allowWrite !== true) throw new TypeError('Workspace creation requires an authorized cache lease.'); result = await worker.create(claim.binding, { ...claim.options, requestKey: claim.requestKey, ...(allowLocalFixtures && fixtureRemote ? { fixtureRemote: fixtureRemote(claim.binding) } : {}) }); break;
    case 'inspect': result = claim.renewLease===false&&!claim.options?.includeRepository ? await worker.inspectMetadata(claim.workspace_id, claim.binding) : await worker.inspect(claim.workspace_id, claim.binding, claim.options?.worktree); break;
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
 // No fixed connection/request ceiling: bounded bodies and measured memory admission remain.
 const maintenance = new NativeGitWorker({ root, authorize: async () => false, now });
 const timer = setInterval(() => singleWorkspaceId?Promise.resolve():maintenance.prune({ skip: busy }).catch(() => process.stderr.write('Native Git cleanup failed; inspect storage permissions and capacity.\n')), 60000); timer.unref();
 server.on('close', () => {clearInterval(timer);monitor.close();});
 return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 const root = process.env.NATIVE_GIT_STORAGE_ROOT;
 if (!root) throw new TypeError('Set NATIVE_GIT_STORAGE_ROOT to the mounted persistent volume.');
 const server=nativeGitServer({root,key:process.env.NATIVE_GIT_CONTROL_PUBLIC_KEY??process.env.NATIVE_GIT_WORKER_KEY,resourcePolicy:resourcePolicyFromEnv(process.env),singleWorkspaceId:process.env.NATIVE_GIT_SINGLE_WORKSPACE_ID,singleBinding:process.env.NATIVE_GIT_SINGLE_BINDING,authorityUrl:process.env.NATIVE_GIT_AUTHORITY_URL});
 server.listen(Number(process.env.PORT??3000),'0.0.0.0');
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close(()=>{process.exitCode=0;}));
}
