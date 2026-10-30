// CI-owned multi-container mount/process/volume proof. No provider credentials.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,generateKeyPairSync,createHash,sign} from 'node:crypto';
import {NativeGitWorker} from '../native-git/engine.js';
import {exportWorkspace} from '../native-git/snapshot.js';
import {allocationPlan} from '../../src/playground/dokploy.js';
const dir=await mkdtemp(join(tmpdir(),'allocation-image-')),seed=join(dir,'seed'),binding={authority:'fixture',connection:'fixture',owner:'example-org',repo:'hello'};
const run=(args,options={})=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:60000,maxBuffer:2*1024*1024,...options}).trim();
const {privateKey,publicKey}=generateKeyPairSync('ed25519'),verificationKey='ed25519:'+publicKey.export({format:'der',type:'spki'}).toString('base64');
const allocationBinding=randomBytes(32).toString('hex'),key=randomBytes(32).toString('base64');let plan,file,compose;
try{
 await mkdir(seed);const git=(...args)=>execFileSync('git',args,{cwd:seed,stdio:'pipe'});git('init','-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@example.test');await writeFile(join(seed,'tracked.txt'),'base\n');git('add','.');git('commit','-m','base');
 const source=new NativeGitWorker({root:join(dir,'source'),authorize:async()=>true,allowLocalFixtures:true}),opened=await source.create(binding,{fixtureRemote:seed,requestKey:'open'}),worker=opened.workspace_id;
 await source.execute(worker,binding,{operation:'write_file',args:{path:'uncommitted.txt',base64:Buffer.from('preserved').toString('base64')},requestKey:'edit',expectedGeneration:opened.generation});
 const bytes=await exportWorkspace({root:source.root,id:worker,key});
 const nativeBinding=createHash('sha256').update(JSON.stringify(['authority','connection','owner','repo'].map(k=>binding[k]))).digest('hex');
 plan=allocationPlan({binding:allocationBinding,verificationKey,idleTimeoutMs:14400000},{image:'robinson-coding:test',worker,nativeBinding,ingress:'107.90.116.157'});
 const model=JSON.parse(plan.composeFile);
 // This scenario isolates mounted-file and namespace teardown proof. Signed
 // heartbeat/expiry behavior has separate tests; no authority claim comes from it.
 delete model.services.coding.environment.CODING_LIFECYCLE_URL;
 model.services.coding.ports=['127.0.0.1::3000'];file=join(dir,'compose.json');await writeFile(file,JSON.stringify(model));
 compose=(...args)=>run(['compose','-f',file,...args]);compose('up','-d');
 const coding=compose('ps','-q','coding'),broker=compose('ps','-q','broker');assert(coding&&broker);
 const expectedBinding=nativeBinding;
 const imported=run(['exec','-i',broker,'node','--input-type=module','-e',"import {importMountedWorkspace} from './workers/native-git/snapshot.js';let data='';for await(const b of process.stdin)data+=b;console.log(JSON.stringify(await importMountedWorkspace({...JSON.parse(data),bytes:Buffer.from(JSON.parse(data).bytes,'base64')})));"],{input:JSON.stringify({root:'/data',id:worker,key,expectedBinding,bytes:bytes.toString('base64')})});assert.equal(JSON.parse(imported).complete,true);
 const port=compose('port','coding','3000').split(':').at(-1),origin='http://127.0.0.1:'+port;
 const call=async(action,options={})=>{const body=JSON.stringify({purpose:'robinson-coding/v1',binding:allocationBinding,expiresAt:Date.now()+60000,action,options});const res=await fetch(origin+'/v1/coding',{method:'POST',headers:{'Content-Type':'application/json','x-robinson-signature':'ed25519:'+sign(null,Buffer.from(body),privateKey).toString('base64url')},body});assert(res.ok,await res.clone().text());return res.json();};
 let ready=false;for(let i=0;i<100;i++){try{ready=(await call('capabilities')).repository.gitReadOnly===true;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,50));}assert(ready);
 const started=await call('start',{requestKey:'shared-files',argv:['node','-e',"const fs=require('fs');if(process.getuid()!==1000)process.exit(3);if(fs.readFileSync('uncommitted.txt','utf8')!=='preserved')process.exit(4);try{fs.writeFileSync('.git/config','attack');process.exit(5)}catch(e){if(e.code!=='EROFS')throw e}fs.writeFileSync('tracked.txt','edited by runtime');const p=require('child_process').spawn(process.execPath,['-e',`setInterval(()=>{},1000)`],{detached:true,stdio:'ignore'});p.unref();fs.writeFileSync('daemon.pid',String(p.pid));"]});
 let terminal;for(let i=0;i<100;i++){terminal=await call('status',{id:started.id});if(['completed','failed'].includes(terminal.state))break;await new Promise(r=>setTimeout(r,50));}assert.equal(terminal.exitCode,0);
 assert.equal(run(['exec',broker,'cat','/data/'+worker+'/repo/tracked.txt']),'edited by runtime');assert.equal(run(['exec',broker,'git','-C','/data/'+worker+'/repo','rev-parse','HEAD']),opened.head);
 assert.match(run(['exec',broker,'git','-C','/data/'+worker+'/repo','status','--porcelain']),/tracked.txt/);
 const pid=run(['exec',coding,'cat','/workspace/repo/daemon.pid']);assert(Number(pid)>0);run(['exec',coding,'kill','-0',pid]);
 compose('stop');const state=JSON.parse(run(['inspect',coding]));assert.equal(state[0].State.Running,false);assert.equal(state[0].State.Pid,0);
 compose('down','--volumes','--remove-orphans');
 for(const volume of plan.volumes){let absent=false;try{run(['volume','inspect',volume]);}catch(error){absent=/No such volume/.test(String(error.stderr));}assert(absent,'Exact owned volume must be absent.');}
 assert.equal(compose('ps','-aq'),'');console.log('PASS: real shared files, read-only Git metadata, UID1000, daemon namespace termination and exact volume absence.');
}finally{if(compose)try{compose('down','--volumes','--remove-orphans');}catch{}await rm(dir,{recursive:true,force:true});}
