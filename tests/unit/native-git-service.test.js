import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { NativeGitWorker } from '../../workers/native-git/engine.js';
import { nativeGitServer } from '../../workers/native-git/server.js';
import { signWorkerBody, verifyWorkerBody, workerUrl } from '../../src/native-git/protocol.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { requestKey } from '../../src/github/client.js';
import { nativeConnection } from '../../src/native-git/client.js';
import {TenantCapacityError} from '../../src/tenancy/runtime-limits.js';
import { registry } from '../../src/tools/index.js';

const KEY = 'FAKE-worker-service-key-for-local-tests-only';
let dir, bare, server, origin, w, requests, asymmetric, routeEnv, routeOrigins, secondServer,pressure;
const fixtureResources=()=>({policy:{minMemoryBytes:33554432,minDiskBytes:67108864,maxLoopDelayMs:250},body:()=>({allowed:true}),check:async()=>pressure?{allowed:false,reason:pressure,retryAfterSeconds:2}:{allowed:true},close(){}});
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
beforeEach(async () => {
 dir = await mkdtemp(join(tmpdir(), 'native-service-')); const seed = join(dir, 'seed'); bare = join(dir, 'remote.git');
 await mkdir(seed); git(seed, 'init', '-b', 'main'); git(seed, 'config', 'user.name', 'Fixture'); git(seed, 'config', 'user.email', 'fixture@example.test');
 await writeFile(join(seed, 'file.txt'), 'initial\n'); git(seed, 'add', 'file.txt'); git(seed, 'commit', '-m', 'initial'); git(dir, 'clone', '--bare', seed, bare);
 w = await makeWorld({ mode: 'production', profile: 'full' }); requests = []; asymmetric = false; routeEnv={}; routeOrigins=new Map(); secondServer=null; pressure=null;
 server = nativeGitServer({ root: join(dir, 'storage'), key: KEY, now: w.ctx.now, allowLocalFixtures: true, fixtureRemote: () => bare,resources:fixtureResources() });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`; routeOrigins.set('https://worker.example.test',origin);
 w.gh.when('GET /repos/{owner}/{repo}').reply(200, { full_name: 'example-org/hello', default_branch: 'main' });
});
afterEach(async () => { vi.restoreAllMocks(); if(secondServer) await new Promise(resolve=>secondServer.close(resolve)); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
async function invoke(name, args, connection = w.connection) {
 const run = createDispatch({ ...w.ctx, env: { ...w.ctx.env, NATIVE_GIT_WORKER_URL: 'https://worker.example.test/', ...(asymmetric ? {} : { NATIVE_GIT_WORKER_KEY: KEY }), ...routeEnv }, gates: [], fetch: async (url, init) => {
  const host=new URL(url).origin;
  const routed=host==='https://worker.example.test'?origin:routeOrigins.get(host);
  if (routed) { requests.push(JSON.parse(init.body)); return fetch(routed + '/v1/workspace', init); }
  return w.gh.fetch(url, init);
 } });
 return run({ registry, name, args, connection, db: w.db });
}
async function opened() {
 const result = parse(await invoke('github_git_workspace_open', { owner: 'example-org', repo: 'hello' }));
 expect(result.status, JSON.stringify(result)).toBe('applied'); return result.result.workspace_id;
}
it('verifies internal signatures, expiry, fixed origin and non-write grants', async () => {
 const lease = JSON.stringify({ version: 2, action: 'inspect', expiresAt: w.ctx.now() + 60000 });
 expect(verifyWorkerBody(lease, signWorkerBody(lease, KEY), KEY, w.ctx.now()).action).toBe('inspect');
 expect(() => verifyWorkerBody(lease, signWorkerBody(lease + 'x', KEY), KEY, w.ctx.now())).toThrow(/authorization/);
 expect(() => verifyWorkerBody(lease, signWorkerBody(lease, KEY), KEY, w.ctx.now() + 60001)).toThrow(/Expired/);
 expect(() => workerUrl({ NATIVE_GIT_WORKER_URL: 'http://untrusted.test' })).toThrow(/HTTPS/);
 const denied = await fetch(origin + '/v1/workspace', { method: 'POST', body: lease }); expect(denied.status).toBe(401);
 expect(JSON.stringify(await denied.json())).not.toContain(KEY);
});
it('opens through MCP, makes a native edit, reads exact bytes and independently disposes the workspace', async () => {
 const id = await opened();
 const changed = parse(await invoke('github_git_workspace_run', { workspace_id: id, operation: 'write_file', expectedGeneration: 0, options: { path: 'file.txt', base64: Buffer.from('changed\n').toString('base64') } }));
 expect(changed.status, JSON.stringify(changed)).toBe('applied');
 expect(changed.result.workspace.generation).toBe(1);
 const result = parse(await invoke('github_git_workspace_read', { workspace_id: id, operation: 'read_file', options: { path: 'file.txt' }, byteLength: 32768 }));
 expect(Buffer.from(result.content_base64, 'base64').toString()).toBe('changed\n'); expect(result.file_hash).toMatch(/^[a-f0-9]{64}$/);
 const closed = parse(await invoke('github_git_workspace_close', { workspace_id: id }));
 expect(closed.status, JSON.stringify(closed)).toBe('applied'); expect(closed.result.disposed).toBe(true);
 const missing = await invoke('github_git_workspace_read', { workspace_id: id, operation: 'status' }); expect(missing.isError).toBe(true);
 expect(w.gh.invalid).toEqual([]);
});
it('revalidates provider access before cached reads and never exposes another connection’s workspace', async () => {
 const id = await opened(); const count = requests.length;
 const foreign = await invoke('github_git_workspace_read', { workspace_id: id, operation: 'status' }, { ...w.connection, client_id: 'different-client' });
 expect(foreign.isError).toBe(true); expect(requests).toHaveLength(count);
 w.gh.when('GET /repos/{owner}/{repo}').reply(403, { message: 'Access revoked' });
 const denied = await invoke('github_git_workspace_read', { workspace_id: id, operation: 'status' });
 expect(denied.isError).toBe(true); expect(requests).toHaveLength(count);
});
it('preserves dry runs, read-only grants and immutable write replay through the dispatcher', async () => {
 const preview = parse(await invoke('github_git_workspace_open', { owner: 'example-org', repo: 'hello', dryRun: true })); expect(preview.status).toBe('preview'); expect(requests.filter(r=>r.action!=='capabilities')).toHaveLength(0);
 const denied = await invoke('github_git_workspace_open', { owner: 'example-org', repo: 'hello' }, { ...w.connection, profile: 'read_only' }); expect(denied.isError).toBe(true); expect(requests.filter(r=>r.action!=='capabilities')).toHaveLength(0);
 const id = await opened(); const args = { workspace_id: id, operation: 'branch_create', expectedGeneration: 0, options: { name: 'topic' }, requestKey: 'native-replay-intent' };
 const first = parse(await invoke('github_git_workspace_run', args)); expect(first.status).toBe('applied');
 const count = requests.filter(r => r.action === 'run').length;
 const again = parse(await invoke('github_git_workspace_run', args)); expect(again.replayed).toBe(true);
 expect(requests.filter(r => r.action === 'run')).toHaveLength(count);
});

it('reports actual signed worker capabilities and pages connection-bound workspace IDs', async () => {
 const capabilities = parse(await invoke('github_git_workspace_read', { operation: 'capabilities' }));
 expect(capabilities.worker.ready).toBe(true); expect(capabilities.worker.native_git).toContain('git version');
 expect(capabilities.unsupported.map(x => x.feature)).toContain('LFS');
 const id = await opened();
 const inventory = parse(await invoke('github_git_workspace_list', { max: 1 }));
 expect(inventory.items).toMatchObject([{ workspace_id: id, owner: 'example-org', repo: 'hello' }]); expect(inventory.next_cursor).toBeNull(); expect(inventory.complete).toBe(true);
 expect(JSON.stringify(inventory)).not.toContain('authority');
});

it('relays a stated content-protection refusal and returns a value-free report for an uncommitted file', async () => {
 const id = await opened();
 const { nativeConnection } = await import('../../src/native-git/client.js');
 const row = await w.db.getJob(id, nativeConnection(w.ctx)); const backend = JSON.parse(row.provider_ref).worker;
 const candidate = 'rtc_pass_' + 'a'.repeat(43);
 await writeFile(join(dir, 'storage', backend, 'repo', 'sensitive.txt'), candidate);
 const denied = await invoke('github_git_workspace_read', { workspace_id: id, operation: 'read_file', options: { path: 'sensitive.txt' }, byteLength: 8 });
 expect(denied.isError).toBe(true); expect(JSON.stringify(denied)).toContain('content protection'); expect(JSON.stringify(denied)).toContain('protection_check'); expect(JSON.stringify(denied)).not.toContain(candidate);
 const report = parse(await invoke('github_git_workspace_read', { workspace_id: id, operation: 'protection_check', options: { path: 'sensitive.txt' } }));
 expect(report.total_findings).toBe(1); expect(report.matched_values_returned).toBe(false); expect(JSON.stringify(report)).not.toContain(candidate);
});
it('never releases another request’s active workspace lock when a busy request is refused', async () => {
 const id = await opened();
 const { nativeConnection } = await import('../../src/native-git/client.js');
 const row = await w.db.getJob(id, nativeConnection(w.ctx)); const backend = JSON.parse(row.provider_ref).worker;
 const binding = requests.find(r => r.action === 'open').binding;
 const body = JSON.stringify({ version: 2, scannerPolicy:{settings:{additionalRules:[],disabledRules:[],suppressions:[]},revision:0}, action: 'inspect', binding, workspace_id: backend, expiresAt: w.ctx.now() + 60000 });
 const statuses = await Promise.all(Array.from({ length: 5 }, async () => {
  const response = await fetch(origin + '/v1/workspace', { method: 'POST', body, headers: { 'x-robinson-signature': signWorkerBody(body, KEY) } }); await response.text(); return response.status;
 }));
 expect(statuses.filter(x => x === 200)).toHaveLength(1); expect(statuses.filter(x => x === 409)).toHaveLength(4);
 const after = await fetch(origin + '/v1/workspace', { method: 'POST', body, headers: { 'x-robinson-signature': signWorkerBody(body, KEY) } }); expect(after.status).toBe(200); await after.text();
});

it('executes a real MCP clone with only a public verification key on the worker', async () => {
 const { nativeWorkerPublicKey } = await import('../../src/native-git/signing.js');
 server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
 server = nativeGitServer({ root: join(dir, 'storage'), key: nativeWorkerPublicKey(w.ctx.env), now: w.ctx.now, allowLocalFixtures: true, fixtureRemote: () => bare,resources:fixtureResources() });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`; asymmetric = true;
 const id = await opened(); expect(id).toMatch(/^job_/);
 const state = parse(await invoke('github_git_workspace_read', { workspace_id: id, operation: 'status' })); expect(state.state).toBe('ready');
 expect(requests.every(r => !Object.hasOwn(r, 'signingKey'))).toBe(true);
});

it('brokers current repository scanner rules into signed worker calls and protects native file reads',async()=>{
 const {scannerSettingKey}=await import('../../src/github/scanner-policy.js');
 await w.db.setSetting(scannerSettingKey('example-org','hello'),{revision:1,settings:{additionalRules:[{id:'custom_initial_word',label:'Synthetic native fixture marker',type:'prefix',prefix:'ini',alphabet:'alnum',minLength:4,maxLength:30}],disabledRules:[],suppressions:[]},history:[]});
 const id=await opened();const report=parse(await invoke('github_git_workspace_read',{workspace_id:id,operation:'protection_check',options:{path:'file.txt'}}));
 expect(report.findings).toMatchObject([{rule:'custom_initial_word'}]);expect(report.policy_revision).toBe(1);
 expect((await invoke('github_git_workspace_read',{workspace_id:id,operation:'read_file',options:{path:'file.txt'},byteLength:32768})).isError).toBe(true);
 expect(requests.at(-1).scannerPolicy.revision).toBe(1);expect(requests.at(-1).scannerPolicy.settings.additionalRules[0].id).toBe('custom_initial_word');
});

it('switches branches through the dispatcher with explicit aliases, verified branch and immutable replay', async () => {
 const id = await opened();
 const created = parse(await invoke('github_git_workspace_run', { workspace_id: id, operation: 'branch_create', expectedGeneration: 0, options: { name: 'topic' } }));
 expect(created.status).toBe('applied');
 let generation = 1;
 for (const options of [{ branch: 'topic' }, { ref: 'main' }, { name: 'topic' }]) {
  const args = { workspace_id: id, operation: 'switch', expectedGeneration: generation, options, requestKey: `switch-alias-${generation}` };
  const result = parse(await invoke('github_git_workspace_run', args));
  expect(result.status, JSON.stringify(result)).toBe('applied');
  expect(result.result.workspace.branch).toBe(Object.values(options)[0]);
  expect(result.result.workspace.generation).toBe(++generation);
  const count = requests.filter(r => r.action === 'run').length;
  expect(parse(await invoke('github_git_workspace_run', args)).replayed).toBe(true);
  expect(requests.filter(r => r.action === 'run')).toHaveLength(count);
 }
});
it('explains invalid switch input before sending a worker mutation', async () => {
 const id = await opened();
 for (const options of [{}, { name: 'main', branch: 'other' }, { branch: '--detach' }, { branch: 'a..b' }]) {
  const count = requests.filter(r => r.action === 'run').length;
  const result = parse(await invoke('github_git_workspace_run', { workspace_id: id, operation: 'switch', expectedGeneration: 0, options }));
  expect(result.status).toBe('refused_by_guard');
  expect(result.error).not.toContain('Try again in a moment');
  expect(result.error).toMatch(/branch|reference|argument/i);
  expect(requests.filter(r => r.action === 'run')).toHaveLength(count);
 }
});


it.each([12])('serves %i independent workspaces concurrently with per-workspace exclusion and bounded overload', async capacity => {
 if (capacity !== 2) {
  await new Promise(resolve => server.close(resolve));
  server = nativeGitServer({root:join(dir,'storage'),key:KEY,now:w.ctx.now,allowLocalFixtures:true,fixtureRemote:()=>bare,resources:fixtureResources()});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
 }
 const capabilities = parse(await invoke('github_git_workspace_read',{operation:'capabilities'}));
 expect(capabilities.worker.max_concurrent).toBeNull();expect(capabilities.worker.capacity_mode).toBe('resource-aware');
 const ids = [];
 for (let i=0;i<capacity;i++) ids.push(parse(await invoke('github_git_workspace_open',{owner:'example-org',repo:'hello',requestKey:`concurrent-workspace-${i}`})).result.workspace_id);
 const { nativeConnection } = await import('../../src/native-git/client.js');
 const bodyFor = async id => {
  const row = await w.db.getJob(id, nativeConnection(w.ctx));
  const meta = JSON.parse(row.provider_ref);
  return JSON.stringify({ version: 2, scannerPolicy: {settings: {additionalRules:[],disabledRules:[],suppressions:[]},revision:0}, action: 'inspect', workspace_id: meta.worker, binding: {authority:meta.authority,connection:nativeConnection(w.ctx),owner:row.owner,repo:row.repo}, expiresAt: w.ctx.now()+60000 });
 };
 const send = body => fetch(origin+'/v1/workspace', {method:'POST',body,headers:{'x-robinson-signature':signWorkerBody(body,KEY)}});
 const bodies = await Promise.all(ids.map(bodyFor));
 let entered = 0, release, arrived;
 const held = new Promise(resolve => { release=resolve; });
 const all = new Promise(resolve => { arrived=resolve; });
 const original = NativeGitWorker.prototype.inspect;
 vi.spyOn(NativeGitWorker.prototype,'inspect').mockImplementation(async function(...args) {
  if (++entered===capacity) arrived();
  await held;
  return original.apply(this,args);
 });
 const pending = bodies.map(send);
 try {
  await all;
  const busy = await send(bodies[0]); expect(busy.status).toBe(409); expect((await busy.json()).error).toBe('workspace_busy');
  const extra = JSON.parse(bodies[0]); extra.workspace_id='git_'+'f'.repeat(32);
  pressure='memory_pressure';
  const full = await send(JSON.stringify(extra)); expect(full.status).toBe(429); expect(full.headers.get('retry-after')).toBe('2'); await full.text();
 } finally {pressure=null;release(); }
 const responses = await Promise.all(pending);
 for (const response of responses) { expect(response.status).toBe(200); expect((await response.json()).branch).toBe('main'); }
 const again = await send(bodies[0]); expect(again.status).toBe(200); await again.text();
});

it('creates and verifies a branch using branch alias and supplies exact operation help', async () => {
 const id=await opened();
 const help=parse(await invoke('github_git_workspace_read',{operation:'capabilities',options:{name:'branch_create'}}));
 expect(help.operation_help.required).toContain('name or branch');
 const result=parse(await invoke('github_git_workspace_run',{workspace_id:id,operation:'branch_create',expectedGeneration:0,options:{branch:'alias-topic',ref:'HEAD'},requestKey:'branch-alias-intent'}));
 expect(result.status,JSON.stringify(result)).toBe('applied');
 expect(result.result.reference).toMatchObject({name:'alias-topic',exists:true});
 const count=requests.filter(r=>r.action==='run').length;
 const invalid=parse(await invoke('github_git_workspace_run',{workspace_id:id,operation:'branch_create',expectedGeneration:1,options:{branch:'other',name:'conflict'},dryRun:true}));
 expect(invalid.preflight_failed).toBe(true);expect(invalid.warning).toContain('disagree');expect(requests.filter(r=>r.action==='run')).toHaveLength(count);
});
it('keeps closed clone replay historical and opens a separate workspace only with a fresh intent',async()=>{
 const args={owner:'example-org',repo:'hello',requestKey:'original-clone'};
 const first=parse(await invoke('github_git_workspace_open',args));const id=first.result.workspace_id;
 expect(parse(await invoke('github_git_workspace_close',{workspace_id:id,requestKey:'dispose-original'})).status).toBe('applied');
 const count=requests.filter(r=>r.action==='open').length;
 w.advanceClock(61*60000);
 const replay=parse(await invoke('github_git_workspace_open',args));
 expect(replay.status).toBe('replayed');expect(replay.historical).toBe(true);expect(replay.done).toBe(false);
 expect(replay.result.workspace_id).toBe(id);expect(replay.current_workspace).toMatchObject({workspace_id:id,state:'disposed',available:false});
 expect(requests.filter(r=>r.action==='open')).toHaveLength(count);
 const fresh=parse(await invoke('github_git_workspace_open',{...args,requestKey:'new-clone'}));
 expect(fresh.status).toBe('applied');expect(fresh.result.workspace_id).not.toBe(id);
 expect(parse(await invoke('github_git_workspace_run',{workspace_id:fresh.result.workspace_id,operation:'branch_create',expectedGeneration:0,options:{branch:'fresh-topic'}})).status).toBe('applied');
});

it('verifies rename/delete aliases and rejects invalid branch operations without sending a mutation', async () => {
 const id = await opened();
 const run = (operation, generation, options) => invoke('github_git_workspace_run', {workspace_id:id, operation, expectedGeneration:generation, options});
 expect(parse(await run('branch_create',0,{branch:'before'})).status).toBe('applied');
 const renamed=parse(await run('branch_rename',1,{branch:'after',ref:'before'}));
 expect(renamed.status).toBe('applied');expect(renamed.result.reference).toMatchObject({name:'after',exists:true});
 expect(parse(await run('branch_delete',2,{name:'after'})).result.reference.exists).toBe(false);
 const count=requests.filter(r=>r.action==='run').length;
 for(const options of [{branch:'x',name:'y'},{branch:'--bad'},{branch:'ok',staged:true}]) {
  const result=parse(await run('branch_create',3,options));expect(result.status).toBe('refused_by_guard');expect(result.error).toContain('Native branch_create arguments');
 }
 expect(requests.filter(r=>r.action==='run')).toHaveLength(count);
});
it('rechecks active replay availability and never turns revoked access into a replayed clone',async()=>{
 const args={owner:'example-org',repo:'hello',requestKey:'active-clone'};
 const first=parse(await invoke('github_git_workspace_open',args));
 const replay=parse(await invoke('github_git_workspace_open',args));
 expect(replay).toMatchObject({status:'replayed',done:true,historical:true,current_workspace:{workspace_id:first.result.workspace_id,available:true,state:'ready'}});
 expect(requests.filter(r=>r.action==='open')).toHaveLength(1);
 w.gh.when('GET /repos/{owner}/{repo}').reply(403,{message:'Access revoked'});
 const denied=await invoke('github_git_workspace_open',args);expect(denied.isError).toBe(true);
 expect(requests.filter(r=>r.action==='open')).toHaveLength(1);
});
it('marks a missing worker workspace unavailable on clone replay without creating another clone',async()=>{
 const args={owner:'example-org',repo:'hello',requestKey:'missing-clone'};
 const first=parse(await invoke('github_git_workspace_open',args));
 const {nativeConnection}=await import('../../src/native-git/client.js');
 const row=await w.db.getJob(first.result.workspace_id,nativeConnection(w.ctx));
 await rm(join(dir,'storage',JSON.parse(row.provider_ref).worker),{recursive:true,force:true});
 const replay=parse(await invoke('github_git_workspace_open',args));
 expect(replay).toMatchObject({status:'replayed',historical:true,done:false,current_workspace:{available:false,state:'unavailable'}});
 expect(requests.filter(r=>r.action==='open')).toHaveLength(1);
});
it('fetches and merges moved main with two real parents, then pushes the same commit to a new remote branch',async()=>{
 const id=await opened();let generation=0;
 const run=async(operation,options={})=>{
  const result=parse(await invoke('github_git_workspace_run',{workspace_id:id,operation,expectedGeneration:generation,options,requestKey:'graph-'+generation,confirm:true}));
  expect(result.status,JSON.stringify(result)).toBe('applied');generation=result.result.workspace.generation;return result;
 };
 await run('branch_create',{branch:'topic'});await run('switch',{branch:'topic'});
 await run('write_file',{path:'topic.txt',base64:Buffer.from('topic\n').toString('base64')});
 await run('add',{paths:['topic.txt']});const local=await run('commit',{message:'topic commit'});
 const other=join(dir,'other');git(dir,'clone',bare,other);git(other,'config','user.name','Fixture');git(other,'config','user.email','fixture@example.test');
 await writeFile(join(other,'main.txt'),'moved main\n');git(other,'add','.');git(other,'commit','-m','main moved');git(other,'push','origin','main');const main=git(other,'rev-parse','HEAD');
 await run('fetch');const merged=await run('merge',{ref:'origin/main'});
 const head=merged.result.workspace.head;expect(head).not.toBe(local.result.workspace.head);
 const log=parse(await invoke('github_git_workspace_read',{workspace_id:id,operation:'log',options:{max:1}}));
 expect(log.stdout.split('\0')[1].split(' ')).toEqual([local.result.workspace.head,main]);
 const pushed=await run('push',{branch:'new-topic',expectedHead:''});
 expect(pushed.result.operation.remote_head).toBe(head);
 expect(git(bare,'rev-parse','refs/heads/new-topic')).toBe(head);
 expect(git(bare,'rev-list','--parents','-n','1',head).split(' ')).toEqual([head,local.result.workspace.head,main]);
});
it.each(['a'.repeat(250),'prefix/'+'a'.repeat(249)])('verifies accepted long branch names without truncating their full refs: %s',async name=>{
 const id=await opened();
 const run=async(operation,generation,options)=>parse(await invoke('github_git_workspace_run',{workspace_id:id,operation,expectedGeneration:generation,options}));
 const created=await run('branch_create',0,{branch:name});expect(created.status,JSON.stringify(created)).toBe('applied');expect(created.result.reference).toMatchObject({name,exists:true});
 const renamed=await run('branch_rename',1,{ref:name,branch:'renamed-long'});expect(renamed.status).toBe('applied');
 const deleted=await run('branch_delete',2,{branch:'renamed-long'});expect(deleted.status).toBe('applied');expect(deleted.result.reference.exists).toBe(false);
});
it('names unsupported native arguments with a stable no-send reason code',async()=>{
 const id=await opened(),count=requests.filter(r=>r.action==='run').length;
 const result=parse(await invoke('github_git_workspace_run',{workspace_id:id,operation:'branch_create',expectedGeneration:0,options:{branch:'topic',staged:true}}));
 expect(result).toMatchObject({reason_code:'invalid_native_arguments',retryable:false,no_change_sent:true});expect(requests.filter(r=>r.action==='run')).toHaveLength(count);
});

async function legacyReceipt(args, first) {
 const key=requestKey(w.ctx,'github_git_workspace_open',args);
 const {id}=await w.db.claimChange({account:'example-org',repo:'example-org/hello',connection:w.connection.client_id,tool:'github_git_workspace_open',summary:'Legacy clone',requestKey:key});
 await w.db.finishChange(id,{summary:'Legacy clone',after:first.result,confirmed:true});
 return key;
}
it('recovers a legacy bucketed clone after an hour without another open and keeps disposed replay historical',async()=>{
 const args={repo:'hello',requestKey:'legacy-intent'};
 const first=parse(await invoke('github_git_workspace_open',args));
 const legacy=await legacyReceipt(args,first);
 w.advanceClock(61*60000);
 const replay=parse(await invoke('github_git_workspace_open',args));
 expect(replay).toMatchObject({replayed:true,requestKey:legacy,done:true,result:{workspace_id:first.result.workspace_id}});
 expect(requests.filter(r=>r.action==='open')).toHaveLength(1);
 await invoke('github_git_workspace_close',{workspace_id:first.result.workspace_id});
 w.advanceClock(61*60000);
 expect(parse(await invoke('github_git_workspace_open',args))).toMatchObject({replayed:true,done:false,current_workspace:{state:'disposed'}});
 expect(requests.filter(r=>r.action==='open')).toHaveLength(1);
});
it('never recovers legacy receipts into another pass or clones when historical metadata is missing',async()=>{
 const args={repo:'hello',requestKey:'legacy-bound'};
 const first=parse(await invoke('github_git_workspace_open',args));await legacyReceipt(args,first);
 const denied=parse(await invoke('github_git_workspace_open',args,{...w.connection,pass_id:'other-pass'}));
 expect(denied.done).toBe(false);expect(JSON.stringify(denied)).not.toContain(first.result.workspace_id);
 expect(requests.filter(r=>r.action==='open')).toHaveLength(1);
 await w.db.finishJob(first.result.workspace_id,nativeConnection(w.ctx),{state:'ready',detail:'Native workspace disposed.'});
 const get=vi.spyOn(w.db,'getJob').mockResolvedValue(null);
 expect(parse(await invoke('github_git_workspace_open',args)).done).toBe(false);
 expect(requests.filter(r=>r.action==='open')).toHaveLength(1);get.mockRestore();
});
it('binds fresh stable clone intents to the full connection and repository',async()=>{
 const args={repo:'hello',requestKey:'same-raw-key'};
 const first=parse(await invoke('github_git_workspace_open',args));w.advanceClock(61*60000);
 expect(parse(await invoke('github_git_workspace_open',args))).toMatchObject({replayed:true,result:{workspace_id:first.result.workspace_id}});
 const foreign=parse(await invoke('github_git_workspace_open',args,{...w.connection,client_id:'other-client'}));
 expect(foreign.status).toBe('applied');expect(foreign.result.workspace_id).not.toBe(first.result.workspace_id);
 expect(requests.filter(r=>r.action==='open')).toHaveLength(2);
});

it('renews both idle deadlines on authorized reads and writes beyond the original deadline',async()=>{
 const first=parse(await invoke('github_git_workspace_open',{repo:'hello',leaseMinutes:1,requestKey:'idle-active'}));
 const id=first.result.workspace_id, original=first.result.expires_at;
 w.advanceClock(40000);
 const read=parse(await invoke('github_git_workspace_read',{workspace_id:id,operation:'read_file',options:{path:'file.txt'},byteLength:64}));
 expect(read.expires_at).toBe(w.ctx.now()+60000);expect(read.idle_timeout_ms).toBe(60000);
 expect((await w.db.getJob(id,nativeConnection(w.ctx))).expires_at.getTime()).toBe(read.expires_at);
 w.advanceClock(40000);expect(w.ctx.now()).toBeGreaterThan(original);
 const written=parse(await invoke('github_git_workspace_run',{workspace_id:id,operation:'write_file',expectedGeneration:0,options:{path:'file.txt',base64:Buffer.from('active').toString('base64')}}));
 expect(written.status).toBe('applied');expect(written.result.workspace.generation).toBe(1);
 expect(written.result.workspace.expires_at).toBe(w.ctx.now()+60000);
 const row=await w.db.getJob(id,nativeConnection(w.ctx));expect(row.expires_at.getTime()).toBe(written.result.workspace.expires_at);
 const meta=JSON.parse(await readFile(join(dir,'storage',JSON.parse(row.provider_ref).worker,'workspace.json'),'utf8'));
 expect(meta).toMatchObject({idleTimeoutMs:60000,lastActivityAt:w.ctx.now(),expiresAt:w.ctx.now()+60000,generation:1});
});
it('inventory, health checks and foreign or revoked access never renew an idle workspace',async()=>{
 const first=parse(await invoke('github_git_workspace_open',{repo:'hello',leaseMinutes:1,requestKey:'idle-expire'})),id=first.result.workspace_id;
 const row=await w.db.getJob(id,nativeConnection(w.ctx)),backend=JSON.parse(row.provider_ref).worker;
 w.advanceClock(40000);
 await invoke('github_git_workspace_list',{});await invoke('github_git_workspace_read',{operation:'capabilities'});
 await fetch(origin+'/health');
 expect((await invoke('github_git_workspace_read',{workspace_id:id,operation:'status'},{...w.connection,client_id:'foreign'})).isError).toBe(true);
 w.gh.when('GET /repos/{owner}/{repo}').reply(403,{message:'Access revoked'});
 expect((await invoke('github_git_workspace_read',{workspace_id:id,operation:'status'})).isError).toBe(true);
 expect((await w.db.getJob(id,nativeConnection(w.ctx))).expires_at.getTime()).toBe(first.result.expires_at);
 w.advanceClock(21000);expect(await w.db.getJob(id,nativeConnection(w.ctx))).toBeNull();
 const cleanup=new NativeGitWorker({root:join(dir,'storage'),authorize:async()=>false,now:w.ctx.now});
 expect(await cleanup.prune()).toEqual({removed:1});await expect(readFile(join(dir,'storage',backend,'workspace.json'))).rejects.toMatchObject({code:'ENOENT'});
});
it('adopts a legacy workspace without changing its original idle duration or reviving it after expiry',async()=>{
 const binding={authority:'b'.repeat(32),connection:nativeConnection(w.ctx),owner:'example-org',repo:'hello'};
 const worker=new NativeGitWorker({root:join(dir,'storage'),authorize:async()=>true,now:w.ctx.now,allowLocalFixtures:true});
 const opened=await worker.create(binding,{requestKey:'legacy-idle',fixtureRemote:bare,ttlMs:60000});
 const path=join(dir,'storage',opened.workspace_id,'workspace.json'),meta=JSON.parse(await readFile(path,'utf8'));
 delete meta.idleTimeoutMs;delete meta.lastActivityAt;await writeFile(path,JSON.stringify(meta));
 const id='job_1234567890abcdef';await w.db.createJob({id,connection:nativeConnection(w.ctx),owner:'example-org',repo:'hello',kind:'native-git-workspace',providerRef:JSON.stringify({authority:binding.authority,worker:opened.workspace_id}),ttlMinutes:1});
 w.advanceClock(40000);const renewed=parse(await invoke('github_git_workspace_read',{workspace_id:id,operation:'status'}));
 expect(renewed.idle_timeout_ms).toBe(60000);expect(renewed.expires_at).toBe(w.ctx.now()+60000);
 expect(JSON.parse((await w.db.getJob(id,nativeConnection(w.ctx))).provider_ref).idleTimeoutMs).toBe(60000);
 w.advanceClock(40000);expect(parse(await invoke('github_git_workspace_read',{workspace_id:id,operation:'status'})).state).toBe('ready');
 w.advanceClock(61000);expect((await invoke('github_git_workspace_read',{workspace_id:id,operation:'status'})).isError).toBe(true);
 await expect(worker.touch(opened.workspace_id,binding,60000)).rejects.toThrow(/expired/);
});
it('accepts legacy signed protocol-2 requests without silently renewing their fixed database lease',async()=>{
 const first=parse(await invoke('github_git_workspace_open',{repo:'hello',leaseMinutes:1,requestKey:'legacy-wire'}));
 const opened=requests.find(r=>r.action==='open'),row=await w.db.getJob(first.result.workspace_id,nativeConnection(w.ctx));
 w.advanceClock(40000);
 const body=JSON.stringify({version:2,expiresAt:w.ctx.now()+60000,action:'inspect',binding:opened.binding,workspace_id:JSON.parse(row.provider_ref).worker,scannerPolicy:opened.scannerPolicy});
 const response=await fetch(origin+'/v1/workspace',{method:'POST',body,headers:{'x-robinson-signature':signWorkerBody(body,KEY)}});
 expect(response.status).toBe(200);expect((await response.json()).expires_at).toBe(first.result.expires_at);
});

it('defaults new workspaces to four idle hours without treating the worker limit as reserved resources',async()=>{
 const opened=parse(await invoke('github_git_workspace_open',{repo:'hello',requestKey:'four-hour-default'}));
 expect(opened.result.idle_timeout_ms).toBe(4*60*60000);
 expect(opened.result.expires_at).toBe(w.ctx.now()+4*60*60000);
});

it('rejects protocol-3 mutations without a matching signed idle window before Git changes anything',async()=>{
 const id=await opened(),openRequest=requests.find(r=>r.action==='open'),row=await w.db.getJob(id,nativeConnection(w.ctx));
 const body=JSON.stringify({version:3,expiresAt:w.ctx.now()+60000,action:'run',binding:openRequest.binding,workspace_id:JSON.parse(row.provider_ref).worker,operation:'branch_create',options:{branch:'must-not-exist'},expectedGeneration:0,requestKey:'missing-idle',allowWrite:true,scannerPolicy:openRequest.scannerPolicy});
 const response=await fetch(origin+'/v1/workspace',{method:'POST',body,headers:{'x-robinson-signature':signWorkerBody(body,KEY)}});
 expect(response.status).toBe(400);expect((await response.json()).reason).toContain('idle timeout');
 const state=parse(await invoke('github_git_workspace_read',{workspace_id:id,operation:'status'}));expect(state.generation).toBe(0);
 const refs=parse(await invoke('github_git_workspace_read',{workspace_id:id,operation:'refs'}));expect(refs.stdout).not.toContain('must-not-exist');
});
it('does not clear an existing mutation lock when idle renewal is refused',async()=>{
 const id=await opened(),row=await w.db.getJob(id,nativeConnection(w.ctx)),backend=JSON.parse(row.provider_ref).worker;
 const lock=join(dir,'storage',backend,'mutation.lock');await writeFile(lock,'operator-owned-lock');
 const refused=await invoke('github_git_workspace_read',{workspace_id:id,operation:'status'});expect(refused.isError).toBe(true);
 expect(await readFile(lock,'utf8')).toBe('operator-owned-lock');
 await rm(lock);expect(parse(await invoke('github_git_workspace_read',{workspace_id:id,operation:'status'})).state).toBe('ready');
});

it.each([false,true])('keeps real Git bytes, replay and disposal on their own worker across cutover (pre-pin=%s)',async legacy=>{
 const args={owner:'example-org',repo:'hello',requestKey:'old-host-clone'};
 const old=parse(await invoke('github_git_workspace_open',args)).result.workspace_id;
 const row=await w.db.getJob(old,nativeConnection(w.ctx));
 expect(row.provider_ref.length).toBeLessThanOrEqual(200);
 expect(JSON.parse(row.provider_ref).host).toMatch(/^[a-f0-9]{32}$/);
 expect(parse(await invoke('github_git_workspace_run',{workspace_id:old,operation:'write_file',expectedGeneration:0,options:{path:'file.txt',base64:Buffer.from('old-host-only\n').toString('base64')},requestKey:'old-host-edit'})).status).toBe('applied');
 w.advanceClock(1000);
 secondServer=nativeGitServer({root:join(dir,'second-storage'),key:KEY,now:w.ctx.now,allowLocalFixtures:true,fixtureRemote:()=>bare,resources:fixtureResources()});
 await new Promise(resolve=>secondServer.listen(0,'127.0.0.1',resolve));
 routeOrigins.set('https://new-worker.example.test',`http://127.0.0.1:${secondServer.address().port}`);
 routeEnv={NATIVE_GIT_WORKER_URL:'https://new-worker.example.test',NATIVE_GIT_PREVIOUS_WORKER_URL:'https://worker.example.test',NATIVE_GIT_WORKER_CUTOVER_AT:new Date(w.ctx.now()).toISOString()};
 if(legacy){
  const get=w.db.getJob.bind(w.db);
  vi.spyOn(w.db,'getJob').mockImplementation(async(...a)=>{const r=await get(...a);if(r?.kind==='native-git-workspace'){const m=JSON.parse(r.provider_ref);delete m.host;r.provider_ref=JSON.stringify(m);}return r;});
 }
 expect(parse(await invoke('github_git_workspace_read',{operation:'capabilities'})).worker.capacity_mode).toBe('resource-aware');
 const fresh=parse(await invoke('github_git_workspace_open',{...args,requestKey:'new-host-clone'})).result.workspace_id;
 expect(parse(await invoke('github_git_workspace_run',{workspace_id:fresh,operation:'write_file',expectedGeneration:0,options:{path:'file.txt',base64:Buffer.from('new-host-only\n').toString('base64')},requestKey:'new-host-edit'})).status).toBe('applied');
 for(const [id,content] of [[old,'old-host-only\n'],[fresh,'new-host-only\n']]){
  const r=parse(await invoke('github_git_workspace_read',{workspace_id:id,operation:'read_file',options:{path:'file.txt'},byteLength:100}));
  expect(Buffer.from(r.content_base64,'base64').toString()).toBe(content);
 }
 const replay=parse(await invoke('github_git_workspace_open',args));
 expect(replay.status).toBe('replayed');expect(replay.current_workspace).toMatchObject({available:true,generation:1});
 expect(parse(await invoke('github_git_workspace_close',{workspace_id:old,requestKey:'close-old-host'})).result.disposed).toBe(true);
 expect(parse(await invoke('github_git_workspace_read',{workspace_id:fresh,operation:'status'})).generation).toBe(1);
 expect(parse(await invoke('github_git_workspace_close',{workspace_id:fresh,requestKey:'close-new-host'})).result.disposed).toBe(true);
});

it('reports tenant metadata admission refusal as known no-clone rather than uncertain GitHub transport',async()=>{
 vi.spyOn(w.db,'createJob').mockRejectedValue(new TenantCapacityError('job',86400));
 const r=parse(await invoke('github_git_workspace_open',{owner:'example-org',repo:'hello',requestKey:'capacity-denied-clone'}));
 expect(r.status).toBe('rejected');expect(r.done).toBe(false);expect(r.retryable).toBe(true);
 expect(r.error).toContain('before any clone was sent');expect(r.error).not.toContain('GitHub could not be reached');
 expect(requests.filter(r=>r.action!=='capabilities')).toHaveLength(0);
});

it('rejects resource pressure before opening metadata, retries the same intent after recovery, and drains active work',async()=>{
 pressure='storage_pressure';const args={owner:'example-org',repo:'hello',requestKey:'resource-refused-clone'};
 const denied=parse(await invoke('github_git_workspace_open',args));expect(denied.status).toBe('refused_by_guard');expect(denied.reason_code).toBe('native_resource_pressure');expect(denied.retryable).toBe(true);expect(requests.some(r=>r.action==='open')).toBe(false);
 pressure=null;const id=parse(await invoke('github_git_workspace_open',args)).result.workspace_id;
 let release,entered;const held=new Promise(r=>{release=r;});const started=new Promise(r=>{entered=r;});const inspect=NativeGitWorker.prototype.inspect;
 vi.spyOn(NativeGitWorker.prototype,'inspect').mockImplementation(async function(...a){entered();await held;return inspect.apply(this,a);});
 const pending=invoke('github_git_workspace_read',{workspace_id:id,operation:'status'});await started;
 let closed=false;const stopped=new Promise(r=>server.close(()=>{closed=true;r();}));expect(closed).toBe(false);
 release();expect(parse(await pending).state).toBe('ready');await stopped;expect(closed).toBe(true);
});

it('keeps historical clone replay and exact disposal available during resource pressure',async()=>{
 const args={owner:'example-org',repo:'hello',requestKey:'pressure-replay'};
 const first=parse(await invoke('github_git_workspace_open',args));expect(first.status).toBe('applied');
 const id=first.result.workspace_id,clones=requests.filter(r=>r.action==='open').length;
 pressure='memory_pressure';
 const replay=parse(await invoke('github_git_workspace_open',args));
 expect(replay.replayed).toBe(true);expect(replay.result.workspace_id).toBe(id);
 expect(requests.filter(r=>r.action==='open')).toHaveLength(clones);
 const gitSpy=vi.spyOn(NativeGitWorker.prototype,'git');
 const closed=parse(await invoke('github_git_workspace_close',{workspace_id:id}));
 expect(closed.status,JSON.stringify(closed)).toBe('applied');expect(closed.result.disposed).toBe(true);
 expect(gitSpy).not.toHaveBeenCalled();
 const historical=parse(await invoke('github_git_workspace_open',args));expect(historical.replayed).toBe(true);
 expect(requests.filter(r=>r.action==='open')).toHaveLength(clones);
});

it('records admission refusal after metadata creation as rejected and permits safe same-intent retry',async()=>{
 const create=w.db.createJob;
 vi.spyOn(w.db,'createJob').mockImplementation(async(...args)=>{const row=await create(...args);pressure='storage_pressure';return row;});
 const args={owner:'example-org',repo:'hello',requestKey:'pressure-race'};
 const refused=parse(await invoke('github_git_workspace_open',args));expect(refused.status,JSON.stringify(refused)).toBe('rejected');expect(refused.retryable).toBe(true);
 expect(requests.some(r=>r.action==='open')).toBe(true);
 expect(await new NativeGitWorker({root:join(dir,'storage'),authorize:async()=>false}).prune()).toEqual({removed:0});
 vi.restoreAllMocks();pressure=null;
 const retry=parse(await invoke('github_git_workspace_open',args));expect(retry.status,JSON.stringify(retry)).toBe('applied');
});
