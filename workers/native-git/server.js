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
import { NATIVE_OPTIONS_VERSION } from '../../src/native-git/commands.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {createResourceMonitor,resourcePolicyFromEnv,OWNER_PAUSE_FILE,pausedText} from './resources.js';
import {uploadHttp,beginUpload,uploadStatus,applyUpload,pruneUploads} from './upload.js';
import {downloadHttp,beginDownload,downloadStatus,pruneDownloads} from './download.js';
import {remoteHttp,pruneRemotes} from './remote.js';
import {createEgressMonitor} from './egress.js';
import {gitDirectServer,directHost,directIdentity,readDirectFile} from './direct.js';
import {transportSettings,removeLeftoverKeys} from './github-ssh.js';
import {callBroker} from './remote.js';

// GIT-REMOTE-1: `remote` overrides are for local tests only (allowLocalFixtures); production always
// fetches and pushes https://github.com/<owner>/<repo>.git and calls the broker on the claim's own origin.
const GITHUB_REMOTE = (owner, repo) => `https://github.com/${owner}/${repo}.git`;
const BROKER_URL = control => new URL('/api/git-remote?op=broker', control).href;
// GIT-DIRECT-1/-2: `direct` = { identity: await directIdentity(root), env, stored: await readDirectFile(root), listen? }.
// The direct git host is configured by the environment (GIT_DIRECT_ORIGIN + GIT_DIRECT_CONTROL_ORIGIN, which win)
// or by the control plane's signed `direct_configure` action (stored on the volume); once configured, capabilities
// report it so setup can pin the worker key. `listen(server, port)` opens the direct port (default: all interfaces).
// PC-WORKER-2: NATIVE_GIT_BIND_HOST (default all interfaces) lets a host-networked worker listen on loopback only.
export const bindHost = (env = process.env) => { const h = String(env.NATIVE_GIT_BIND_HOST ?? '').trim(); return /^(?:127\.0\.0\.1|::1|0\.0\.0\.0|::)$/.test(h) ? h : '0.0.0.0'; };
const listenDirect = (server, port) => new Promise((resolve, reject) => {
 const fail = error => { server.off('listening', done); reject(error); }, done = () => { server.off('error', fail); resolve(); };
 server.once('error', fail); server.once('listening', done); server.listen(port, bindHost());
});
// SRV-STATUS-1: the commit this image was built from (Dockerfile build argument SOURCE_COMMIT, or Render's RENDER_GIT_COMMIT),
// reported in signed capabilities so github_server_status can warn when the worker is older than the control plane.
export const workerBuildCommit = (env = process.env) => [env.NATIVE_GIT_BUILD_COMMIT, env.RENDER_GIT_COMMIT].find((v) => /^[0-9a-f]{40}$/.test(String(v ?? ''))) ?? null;
/** WORKER-POOL-1: NATIVE_GIT_MAX_WORKSPACES (1-1000), or null when unset or empty. */
export function workspaceLimitFromEnv(env = process.env) {
 const raw = env.NATIVE_GIT_MAX_WORKSPACES;
 if (raw === undefined || raw === '') return null;
 const n = Number(raw);
 if (!Number.isSafeInteger(n) || n < 1 || n > 1000) throw new TypeError('NATIVE_GIT_MAX_WORKSPACES must be a whole number from 1 to 1000.');
 return n;
}
export function nativeGitServer({ root, key, now = Date.now, allowLocalFixtures = false, fixtureRemote, resources, resourcePolicy = {}, singleWorkspaceId, singleBinding, authorityUrl, cloneTimeoutMs = 900000, cloneWaitMs = 30000, remote = {}, githubTransport = transportSettings({}), direct = null, buildCommit = workerBuildCommit(), pauseFile = root ? join(root, OWNER_PAUSE_FILE) : null, maxWorkspaces = null, egressMonitor = null } = {}) {
 workerKey(key); const busy = new Set();
 // WORKER-POOL-1: an optional limit on workspaces held on this host (NATIVE_GIT_MAX_WORKSPACES); null = resources only.
 if (maxWorkspaces !== null && !(Number.isSafeInteger(maxWorkspaces) && maxWorkspaces > 0 && maxWorkspaces <= 1000)) throw new TypeError('Invalid native workspace limit.');
 const counter = new NativeGitWorker({ root, authorize: async () => false, now });
 const activeCount = () => singleWorkspaceId ? Promise.resolve(null) : counter.countActive().catch(() => null);
 // PC-WORKER-1: `<storage>/.owner-pause` (deploy/pc/pc-worker pause) refuses new work; admitted work finishes.
 const monitor=resources??createResourceMonitor({root,policy:resourcePolicy,pauseFile});
 // WORKER-RESOLV-GUARD-1: the worker's own timed resolver verdict, reported in signed
 // capabilities and on /health. A self-created monitor starts here and stops with the
 // server; an injected one (tests, embeddings) is only read.
 const egress = egressMonitor ?? createEgressMonitor();
 if (!egressMonitor) egress.start();
 const host = direct && !singleWorkspaceId ? directHost({ root, identity: direct.identity, env: direct.env ?? {}, local: allowLocalFixtures, stored: direct.stored ?? null, listen: direct.listen ?? listenDirect }) : null;
 const remoteCtx = () => ({ root, key, now, monitor, local: allowLocalFixtures, githubRemote: allowLocalFixtures && remote.github ? remote.github : GITHUB_REMOTE, brokerUrl: allowLocalFixtures && remote.broker ? remote.broker : BROKER_URL, fetchImpl: allowLocalFixtures && remote.fetch ? remote.fetch : fetch, githubTransport: allowLocalFixtures && remote.transport ? remote.transport : githubTransport, ...(allowLocalFixtures && remote.githubSsh ? { githubSshRemote: remote.githubSsh } : {}), ...(allowLocalFixtures && remote.limits ? { limits: remote.limits } : {}), ...(allowLocalFixtures && remote.freeDisk ? { freeDisk: remote.freeDisk } : {}) });
 const gitVersion=execFileSync('git',['--version'],{encoding:'utf8',timeout:2000}).trim();
 // One-time upload bodies may take minutes; every other route keeps its own 15-second body deadline.
 const server = createServer({ requestTimeout: 330000, headersTimeout: 10000, maxHeaderSize: 8192 }, async (req, res) => withProtectionContext(async () => {
  // Never let an unexpected upload failure escape the handler (no paths or details leave it).
  if (req.url?.startsWith('/v1/upload/')) return uploadHttp(req, res, { root, key, now, monitor }).catch(() => { if (res.headersSent) res.destroy(); else { res.statusCode = 500; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end('The upload did not finish. Begin a new upload.\n'); } });
  if (req.url?.startsWith('/v1/remote/') && !singleWorkspaceId) return remoteHttp(req, res, remoteCtx()).catch(() => { if (res.headersSent) res.destroy(); else { res.statusCode = 500; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end('The git remote could not finish this request. Run the git command again.\n'); } });
  if (req.url?.startsWith('/v1/download/')) return downloadHttp(req, res, { root, key, now, monitor }).catch(() => { if (res.headersSent) res.destroy(); else { res.statusCode = 500; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end('The download did not finish. Begin a new download.\n'); } });
  const bodyDeadline = setTimeout(() => req.destroy(), 15000); bodyDeadline.unref(); req.once('end', () => clearTimeout(bodyDeadline)); res.once('close', () => clearTimeout(bodyDeadline));
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json');
  const send = (status, data) => { res.statusCode = status; res.end(JSON.stringify(data)); };
  if (req.method === 'GET' && req.url === '/health') { const e = egress.report(); return send(e.status === 'down' ? 503 : 200, { service: 'robinson-native-git', protocol: WORKER_PROTOCOL, ...(e.status === 'unknown' ? {} : { egress: e.status }) }); }
  if(req.method==='POST'&&req.url==='/v1/authority'&&singleWorkspaceId&&authorityUrl){
   try{let body='';for await(const chunk of req){body+=chunk.toString();if(Buffer.byteLength(body)>16384)return send(413,{error:'request_too_large'});}const url=new URL(authorityUrl);if(url.protocol!=='https:'||url.username||url.password)throw new TypeError('Invalid fixed authority origin.');const answer=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','x-robinson-runtime-signature':String(req.headers['x-robinson-runtime-signature']??'')},body});let text='';for await(const chunk of answer.body){text+=Buffer.from(chunk).toString();if(Buffer.byteLength(text)>16384)throw new TypeError('Authority response is too large.');}res.statusCode=answer.status;const signature=answer.headers.get('x-robinson-signature');if(signature)res.setHeader('x-robinson-signature',signature);return res.end(text);}catch{return send(503,{error:'authority_unavailable'});}
  }
  if (req.method !== 'POST' || req.url !== '/v1/workspace') return send(404, { error: 'not_found' });
  let claim, lockKey, acquired = false;
  try {
   const chunks = []; let bytes = 0;
   for await (const chunk of req) { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) return send(413, { error: 'request_too_large' }); const admitted=monitor.body(bytes);if(!admitted.allowed){res.setHeader('Retry-After','2');return send(429,{error:'worker_resource_pressure',reason:admitted.reason,phase:'admission',no_operation_started:true});}chunks.push(chunk); }
   claim = verifyWorkerBody(Buffer.concat(chunks).toString('utf8'), req.headers['x-robinson-signature'], key, now());
   if (claim.action === 'capabilities') return send(200, { ready: true, protocol: WORKER_PROTOCOL, egress: egress.report(), ...(buildCommit?{build_commit:buildCommit}:{}), native_git:gitVersion,max_concurrent:null,active_workspaces:await activeCount(),max_workspaces:maxWorkspaces,capacity_mode:'resource-aware',resource_policy:monitor.policy,admission:await monitor.check(),...(monitor.paused?.()?{owner_paused:true}:{}),workspace_lease:'idle-v1',repository_attachment:'sealed-mounted-v1',direct_upload:'quarantine-v1',direct_download:'one-time-v1',native_options:NATIVE_OPTIONS_VERSION,upload_apply:'delete-v1',upload_chunks:'chunks-v1',...(singleWorkspaceId?{}:{git_remote:'v1'}),...(host?.report()?{git_direct:host.report()}:{}),...(host?{git_direct_configure:'v1'}:{}),...(singleWorkspaceId?{repository:await repositoryMounts(join(root,singleWorkspaceId,'repo'))}:{}) });
   // GIT-DIRECT-2: the control plane configures (or, with origin null, turns off) the direct git host.
   if (claim.action === 'direct_configure') {
    if (!host) return send(404, { error: 'not_found' });
    if (claim.allowWrite !== true) throw new TypeError('Configuring the direct git host requires an authorized write lease.');
    return send(200, { git_direct: await host.configure(claim.options ?? {}), git_direct_configure: 'v1' });
   }
   if(!claim.scannerPolicy||!Number.isSafeInteger(claim.scannerPolicy.revision)||claim.scannerPolicy.revision<0)throw new TypeError('Protocol 2 requires the current repository scanner policy; update the control plane and worker together.');
   const policy=scannerSettings(claim.scannerPolicy?.settings??defaultScannerSettings());
   return await withRepositoryProtection(policy.additionalRules.filter(r=>!policy.disabledRules.includes(r.id)),async()=>{
   if(singleWorkspaceId){const identity=createHash('sha256').update(JSON.stringify(['authority','connection','owner','repo'].map(k=>claim.binding?.[k]))).digest('hex');if(claim.workspace_id!==singleWorkspaceId||identity!==singleBinding)throw new TypeError('Dedicated Git broker binding differs.');}
   const expected = JSON.stringify(claim.binding);
   lockKey = claim.workspace_id ?? nativeWorkspaceId(claim.binding, claim.requestKey);
   if (busy.has(lockKey)) return send(409, { error: 'workspace_busy', next: 'Inspect after the current operation finishes; do not replay a mutation with a new intent.' });
   busy.add(lockKey); acquired = true;
   if(claim.action!=='close'&&!(claim.action==='inspect'&&claim.renewLease===false)){
    const needsDisk=['open','upload_begin','upload_apply','download_begin'].includes(claim.action)||claim.action==='run'&&!['remove_file','clean'].includes(claim.operation);
    const admitted=await monitor.check({needsDisk});
    if(!admitted.allowed){res.setHeader('Retry-After',String(admitted.retryAfterSeconds??2));return send(429,{error:'worker_resource_pressure',reason:admitted.reason,...(admitted.held_by?{held_by:admitted.held_by}:{}),phase:'admission',no_operation_started:true,next:admitted.reason==='owner_paused'?pausedText(admitted.held_by):'Measured worker resources are under pressure. Inspect state, then retry after resources recover.'});}
   }
   // WORKER-POOL-1: a full host refuses a new clone before anything starts (the control plane then tries the next host).
   if(claim.action==='open'&&maxWorkspaces!==null){const active=await activeCount();if(active===null||active>=maxWorkspaces){res.setHeader('Retry-After','60');return send(429,{error:'worker_resource_pressure',reason:'workspace_limit',phase:'admission',no_operation_started:true,next:'This host holds its maximum number of workspaces. Close a finished workspace, or try again later.'});}}
   const worker = new NativeGitWorker({ root, allowLocalFixtures, now, cloneTimeoutMs, cloneWaitMs, scannerPolicy:{settings:policy,revision:claim.scannerPolicy?.revision??0},
    authorize: async (binding, { write }) => JSON.stringify(binding) === expected && claim.expiresAt > now() && (!write || claim.allowWrite === true),
    credential: async () => { if (typeof claim.credential !== 'string' || !claim.credential) throw new TypeError('Missing short-lived network authorization.'); return claim.credential; }
   });
   if (['open','run','close','upload_begin','upload_apply','download_begin'].includes(claim.action) && claim.allowWrite !== true) throw new TypeError('Workspace mutation requires an authorized write lease.');
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
    case 'upload_begin': result = await beginUpload(worker, claim.workspace_id, claim.binding, claim.options ?? {}); break;
    case 'upload_status': result = await uploadStatus(worker, claim.workspace_id, claim.binding, claim.options ?? {}); break;
    case 'download_begin': result = await beginDownload(worker, claim.workspace_id, claim.binding, claim.options ?? {}); break;
    case 'download_status': result = await downloadStatus(worker, claim.workspace_id, claim.binding, claim.options ?? {}); break;
    case 'upload_apply': result = await applyUpload(worker, claim.workspace_id, claim.binding, { ...(claim.options ?? {}), requestKey: claim.requestKey, expectedGeneration: claim.expectedGeneration }); break;
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
 maintenance.recoverInterruptedClones().catch(() => process.stderr.write('Native Git clone recovery failed; inspect storage.\n'));
 const timer = setInterval(() => singleWorkspaceId?Promise.resolve():maintenance.prune({ skip: busy }).then(()=>pruneUploads(root,now())).then(()=>pruneDownloads(root,now())).then(()=>pruneRemotes(root,now())).then(()=>removeLeftoverKeys(root,{callBroker:(url,claim,body)=>callBroker(url,claim,body,{fetchImpl:allowLocalFixtures&&remote.fetch?remote.fetch:fetch}),now:now()})).catch(() => process.stderr.write('Native Git cleanup failed; inspect storage permissions and capacity.\n')), 60000); timer.unref();
 server.on('close', () => {clearInterval(timer);monitor.close();if (!egressMonitor) egress.stop();if(host?.server?.listening)host.server.close();});
 // The direct git host shares the volume, resource monitor and remote core; it listens on its own port.
 if (host) {
  host.server = gitDirectServer({ ...remoteCtx(), config: () => host.config, identity: direct.identity, ...(allowLocalFixtures && remote.limiter ? { limiter: remote.limiter } : {}), ...(allowLocalFixtures && remote.directFetch ? { fetchImpl: remote.directFetch } : {}) });
  host.server.on('error', () => process.stderr.write('The direct git host listener failed; check GIT_DIRECT_PORT.\n'));
 }
 server.direct = host?.server ?? null; server.directHost = host; server.githubTransport = githubTransport;
 return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 const root = process.env.NATIVE_GIT_STORAGE_ROOT;
 if (!root) throw new TypeError('Set NATIVE_GIT_STORAGE_ROOT to the mounted persistent volume.');
 // The direct git host's key and stored configuration (not for a dedicated single-workspace broker).
 const direct=process.env.NATIVE_GIT_SINGLE_WORKSPACE_ID?null:{identity:await directIdentity(root),env:process.env,stored:await readDirectFile(root).catch(()=>{process.stderr.write('The stored direct git host configuration could not be read; configure it again.\n');return null;})};
 const server=nativeGitServer({root,direct,key:process.env.NATIVE_GIT_CONTROL_PUBLIC_KEY??process.env.NATIVE_GIT_WORKER_KEY,resourcePolicy:resourcePolicyFromEnv(process.env),singleWorkspaceId:process.env.NATIVE_GIT_SINGLE_WORKSPACE_ID,singleBinding:process.env.NATIVE_GIT_SINGLE_BINDING,authorityUrl:process.env.NATIVE_GIT_AUTHORITY_URL,cloneTimeoutMs:Math.min(Math.max(Number(process.env.NATIVE_GIT_CLONE_TIMEOUT_MS??900000)||900000,45000),3600000),maxWorkspaces:workspaceLimitFromEnv(process.env),githubTransport:transportSettings(process.env)});
 // GIT-SSH-LEG-1: a mistyped transport setting keeps HTTPS and says so once.
 for(const problem of server.githubTransport.problems)process.stderr.write(`GitHub transport setting ignored: ${problem}.\n`);
 server.listen(Number(process.env.PORT??3000),bindHost());
 server.directHost?.start().catch(()=>process.stderr.write('The direct git host could not listen on its port; check GIT_DIRECT_PORT.\n'));
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close(()=>{process.exitCode=0;}));
}
