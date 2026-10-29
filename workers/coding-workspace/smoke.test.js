// Mandatory real-image acceptance: runs as the container supervisor UID0;
// every application command MUST be UID1000. Never substitute a same-UID mock.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {mkdtemp,chmod,rm,writeFile,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CodingRuntime} from './runtime.js';
import {codingServer} from './server.js';
const binding='a'.repeat(64),resources=()=>({check:async()=>({allowed:true}),close(){}});
async function fixture(options={}){assert.equal(process.getuid(),0);const root=await mkdtemp(join(tmpdir(),'coding-'));await chmod(root,0o755);return await new CodingRuntime({root,binding,resources:resources(),...options}).init();}
async function settled(r,id){const s=r.active.get(id);if(s)await s.done;return await r.inspect(id);}
async function cleanup(r){await r.shutdown();await rm(r.root,{recursive:true,force:true});}
const node=process.execPath;
test('real command UID, protected control, clean environment and nonzero exit',async()=>{
 const r=await fixture();process.env.CODING_TEST_PRIVATE='not-inherited';
 try{
  const uid=await r.start({requestKey:'uid',argv:['/usr/bin/id','-u']});assert.equal((await settled(r,uid.id)).exitCode,0);assert.equal(Buffer.from((await r.logs(uid.id)).base64,'base64').toString().trim(),'1000');
  const x=await r.start({requestKey:'node',argv:[node,'-e',"require('fs').writeFileSync('build.txt','built');console.log(process.env.CODING_TEST_PRIVATE===undefined);process.exit(7)"]});assert.equal((await settled(r,x.id)).exitCode,7);assert.equal(await readFile(join(r.root,'repo/build.txt'),'utf8'),'built');assert.match(Buffer.from((await r.logs(x.id)).base64,'base64').toString(),/true/);
  const denied=await r.start({requestKey:'denied',argv:[node,'-e',"require('fs').readdirSync('../control')"]});assert.notEqual((await settled(r,denied.id)).exitCode,0);assert.equal((await stat(join(r.root,'control'))).mode&0o077,0);
 }finally{delete process.env.CODING_TEST_PRIVATE;await cleanup(r);}
});
test('durable replay, concurrent duplicate admission, conflict and restart recovery',async()=>{
 const r=await fixture();try{
  const args={requestKey:'once',argv:[node,'-e',"require('fs').appendFileSync('counter','1')"]};const calls=await Promise.allSettled([r.start(args),r.start(args)]);const x=calls.find(x=>x.status==='fulfilled').value;await settled(r,x.id);assert.equal((await r.start(args)).replayed,true);await assert.rejects(r.start({...args,argv:['true']}),{code:'intent_conflict'});assert.equal(await readFile(join(r.root,'repo/counter'),'utf8'),'1');
  await r.shutdown();const crashed='b'.repeat(64);await writeFile(join(r.root,'control',crashed+'.json'),JSON.stringify({id:crashed,state:'starting'}));const restored=await new CodingRuntime({root:r.root,binding,resources:resources()}).init();assert.equal((await restored.start(args)).replayed,true);assert.equal((await restored.inspect(crashed)).state,'uncertain');await restored.shutdown();
 }finally{await cleanup(r);}
});
test('timeout, cancellation, complete paged logs and explicit log overflow failure',async()=>{
 const r=await fixture({maxLogBytes:65536});try{
  const timed=await r.start({requestKey:'timeout',argv:[node,'-e','setInterval(()=>{},1000)'],timeoutMs:30});assert.equal((await settled(r,timed.id)).reason,'timeout');
  const cancel=await r.start({requestKey:'cancel',argv:[node,'-e','setInterval(()=>{},1000)']});assert.equal((await r.cancel(cancel.id)).reason,'cancelled');
  const x=await r.start({requestKey:'logs',argv:[node,'-e',"console.log('x'.repeat(20000))"]});await settled(r,x.id);let offset=0,text='',expectedLogHash;for(;;){const page=await r.logs(x.id,{offset,length:4096,expectedLogHash});expectedLogHash=page.logHash;text+=Buffer.from(page.base64,'base64').toString();offset=page.nextOffset;if(page.complete)break;}assert.equal(text,'x'.repeat(20000)+'\n');await assert.rejects(r.logs(x.id,{offset:1,length:4096}),{code:'log_changed'});
  const over=await r.start({requestKey:'overflow',argv:[node,'-e',"console.log('x'.repeat(100000))"]});assert.equal((await settled(r,over.id)).reason,'log_limit_exceeded');
 }finally{await cleanup(r);}
});
test('directory escape, resource pressure and four-hour inactivity',async()=>{
 let clock=Date.now();const r=await fixture({now:()=>clock});try{
  await assert.rejects(r.start({requestKey:'escape',argv:['true'],cwd:'..'}),{code:'invalid_directory'});
  r.resources.check=async()=>({allowed:false});await assert.rejects(r.start({requestKey:'pressure',argv:['true']}),{code:'resource_pressure'});assert.equal(r.active.size,0);r.resources.check=async()=>({allowed:true});
  const x=await r.start({requestKey:'true',argv:['true']});await settled(r,x.id);clock+=3*3600000;await r.status(x.id);clock+=3*3600000;assert.equal(await r.expire(),false);clock+=3600001;assert.equal(await r.expire(),true);await assert.rejects(r.start({requestKey:'expired',argv:['true']}),{code:'workspace_expired'});
 }finally{await cleanup(r);}
});
test('actual signed HTTP start/status/logs/cancel and foreign request denial; health does not renew',async()=>{
 const r=await fixture(),keys=generateKeyPairSync('ed25519'),key='ed25519:'+keys.publicKey.export({format:'der',type:'spki'}).toString('base64');const server=codingServer({runtime:r,key});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const call=async(action,options={},patch={})=>{const body=JSON.stringify({purpose:'robinson-coding/v1',binding,expiresAt:Date.now()+60000,action,options,scannerPolicy:{revision:0,settings:{additionalRules:[],disabledRules:[],suppressions:[]}},...patch});return await fetch(origin+'/v1/coding',{method:'POST',body,headers:{'x-robinson-signature':'ed25519:'+sign(null,Buffer.from(body),keys.privateKey).toString('base64url')}});};
 try{
  const activity=r.lastActivity;assert.equal((await fetch(origin+'/health')).status,200);assert.equal(r.lastActivity,activity);assert.equal((await call('capabilities')).status,200);assert.equal(r.lastActivity,activity);assert.equal((await call('capabilities',{}, {binding:'b'.repeat(64)})).status,401);
  const started=await call('start',{requestKey:'http',argv:['true']});assert.equal(started.status,202);const x=await started.json();await settled(r,x.id);assert.equal((await (await call('status',{id:x.id})).json()).state,'completed');assert.equal((await (await call('logs',{id:x.id})).json()).complete,true);assert.equal((await call('cancel',{id:x.id})).status,200);
  const synthetic='PLAYFAKE0123456789abcdef';const print=await (await call('start',{requestKey:'custom-log',argv:[node,'-e',"process.stdout.write('PLAYFAKE0123456789abcdef')"]})).json();await settled(r,print.id);const protectedLog=await (await call('logs',{id:print.id},{scannerPolicy:{revision:1,settings:{additionalRules:[{id:'custom_playground',label:'Synthetic log fixture',type:'prefix',prefix:'PLAYFAKE',alphabet:'alnum',minLength:8,maxLength:64}],disabledRules:[],suppressions:[]}}})).json();assert.ok(!Buffer.from(protectedLog.base64,'base64').toString().includes(synthetic));assert.equal(protectedLog.redacted,true);
 }finally{await new Promise(resolve=>server.close(resolve));await cleanup(r);}
});
test('packaged dependency install, TypeScript build/test, PostgreSQL and browser execution',async()=>{
 const r=await fixture();try{
  // Real offline npm lifecycle install: no provider, registry or production DB.
  await writeFile(join(r.root,'repo/package.json'),JSON.stringify({name:'coding-image-fixture',private:true,scripts:{postinstall:"node -e \"require('fs').writeFileSync('installed','yes')\"",build:'node --experimental-strip-types source.ts',test:'node --test app.test.js'}}));
  await writeFile(join(r.root,'repo/source.ts'),"import {writeFileSync} from 'node:fs';const answer:number=42;writeFileSync('build-result',String(answer));\n");await writeFile(join(r.root,'repo/app.test.js'),"import {test} from 'node:test';import assert from 'node:assert/strict';test('app',()=>assert.equal(6*7,42));\n");
  for(const [requestKey,argv] of [['install',['npm','install','--offline','--no-audit','--no-fund']],['build',['npm','run','build']],['test',['npm','test']]]){const x=await r.start({requestKey,argv});assert.equal((await settled(r,x.id)).exitCode,0,requestKey);}
  assert.equal(await readFile(join(r.root,'repo/installed'),'utf8'),'yes');assert.equal(await readFile(join(r.root,'repo/build-result'),'utf8'),'42');
  const db=await r.start({requestKey:'database',argv:['/bin/sh','/app/workers/coding-workspace/test-database']});
  const query=await r.start({requestKey:'sql',argv:[node,'-e',"const {execFileSync}=require('child_process');for(let i=0;i<100;i++){try{const s=execFileSync('psql',[process.env.DATABASE_URL,'-Atc','SELECT 6*7'],{stdio:['ignore','pipe','ignore']}).toString().trim();if(s!=='42')process.exit(1);process.exit(0)}catch{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50)}}process.exit(1)"]});assert.equal((await settled(r,query.id)).exitCode,0);await r.cancel(db.id);
  const browser=await r.start({requestKey:'browser',argv:[node,'--input-type=module','-e',"import {chromium} from '/app/node_modules/playwright/index.mjs';const b=await chromium.launch({headless:true});const p=await b.newPage();await p.setContent('<button>Works</button>');if(await p.locator('button').textContent()!=='Works')process.exitCode=1;await b.close();"]});assert.equal((await settled(r,browser.id)).exitCode,0);
 }finally{await cleanup(r);}
});
