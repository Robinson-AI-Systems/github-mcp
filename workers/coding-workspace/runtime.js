// One separately isolated container per workspace. Never import this into native-git.
import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {mkdir,open,readFile,readdir,rename,realpath,stat} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {createResourceMonitor} from '../native-git/resources.js';
import {redact} from '../../src/github/content-protection.js';
const ID=/^[a-f0-9]{64}$/;
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=(code,message)=>Object.assign(new TypeError(message),{code});
async function atomic(path,value){const temp=path+'.'+randomBytes(8).toString('hex')+'.new';const f=await open(temp,'w',0o600);try{await f.writeFile(JSON.stringify(value));await f.sync();}finally{await f.close();}await rename(temp,path);const d=await open(resolve(path,'..'),'r');try{await d.sync();}finally{await d.close();}}
export class CodingRuntime {
 constructor({root,binding,uid=1000,gid=1000,now=Date.now,maxLogBytes=32*1024*1024,idleMs=4*3600000,resources}={}){
  if(process.getuid?.()!==0)throw fail('isolation_required','Run the supervisor as the isolated container root; commands always use a different unprivileged UID.');
  if(!isAbsolute(root??'')||!ID.test(binding??'')||uid!==1000||gid!==1000||!Number.isSafeInteger(maxLogBytes)||maxLogBytes<1024||maxLogBytes>64*1024*1024||!Number.isSafeInteger(idleMs)||idleMs<60000||idleMs>86400000)throw fail('invalid_configuration','Invalid isolated workspace configuration.');
  Object.assign(this,{root:resolve(root),binding,uid,gid,now,maxLogBytes,idleMs});this.active=new Map();this.admitting=new Set();this.lastActivity=now();this.expired=false;this.stopping=false;this.leaseWrites=Promise.resolve();this.resources=resources??createResourceMonitor({root:this.root});
 }
 async init(){
  const {chown}=await import('node:fs/promises');
  await mkdir(this.root,{recursive:true,mode:0o755});if(await realpath(this.root)!==this.root||(await stat(this.root)).uid!==0||((await stat(this.root)).mode&0o022)!==0)throw fail('invalid_storage','Runtime storage must not be a symlink.');
  for(const name of ['repo','home']){const p=join(this.root,name);await mkdir(p,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});if(await realpath(p)!==p||![0,this.uid].includes((await stat(p)).uid))throw fail('invalid_storage','Provision fresh root-owned storage before first initialization.');await chown(p,this.uid,this.gid);}
  await mkdir(join(this.root,'control'),{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  if(await realpath(join(this.root,'control'))!==join(this.root,'control')||(await stat(join(this.root,'control'))).uid!==0||((await stat(join(this.root,'control'))).mode&0o077)!==0)throw fail('invalid_storage','Control receipts require root-owned private storage.');
  const state=join(this.root,'control','workspace.json');
  try{const prior=JSON.parse(await readFile(state,'utf8'));if(prior.binding!==this.binding)throw fail('binding_mismatch','This volume belongs to another workspace.');this.lastActivity=prior.lastActivity;}
  catch(e){if(e.code!=='ENOENT')throw e;await atomic(state,{binding:this.binding,lastActivity:this.lastActivity});}
  // A container restart must never silently rerun a command whose result is unknown.
  for(const name of await readdir(join(this.root,'control'))){if(!/^[a-f0-9]{64}\.json$/.test(name))continue;const p=join(this.root,'control',name),r=JSON.parse(await readFile(p,'utf8'));if(['starting','running'].includes(r.state)){r.state='uncertain';r.reason='runtime_restarted';await atomic(p,r);}}
  return this;
 }
 async touch(){if(this.expired||this.stopping||this.lastActivity+this.idleMs<=this.now())throw fail('workspace_expired','Four-hour inactivity lease expired or runtime is stopping.');this.lastActivity=Math.max(this.lastActivity,this.now());const write=this.leaseWrites.catch(()=>{}).then(()=>atomic(join(this.root,'control','workspace.json'),{binding:this.binding,lastActivity:this.lastActivity}));this.leaseWrites=write;await write;}
 paths(id){if(!ID.test(id??''))throw fail('invalid_execution','Invalid execution identity.');return {receipt:join(this.root,'control',id+'.json'),log:join(this.root,'control',id+'.log')};}
 async inspect(id){const p=this.paths(id);let r;try{r=JSON.parse(await readFile(p.receipt,'utf8'));}catch(e){if(e.code==='ENOENT')throw fail('execution_not_found','No execution belongs to this workspace.');throw e;}return r;}
 async start({requestKey,argv,cwd='.',timeoutMs=600000}={}){
  await this.touch();
  if(typeof requestKey!=='string'||requestKey.length<1||requestKey.length>128||!Array.isArray(argv)||argv.length<1||argv.length>128||argv.some(s=>typeof s!=='string'||s.includes('\0')||s.length>16384)||!argv[0]||typeof cwd!=='string'||isAbsolute(cwd)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>4*3600000)throw fail('invalid_command','Supply argv, a repository-relative directory and a finite timeout up to four hours.');
  const directory=await realpath(resolve(this.root,'repo',cwd)),repo=join(this.root,'repo');if(directory!==repo&&!directory.startsWith(repo+'/'))throw fail('invalid_directory','Command directory must remain inside this workspace.');
  const id=hash([this.binding,requestKey]),intent=hash({argv,cwd,timeoutMs});const p=this.paths(id);
  if(this.admitting.has(id))throw fail('execution_busy','This execution admission is in progress; inspect the same intent.');
  this.admitting.add(id);try{
  try{const prior=await this.inspect(id);if(prior.intent!==intent)throw fail('intent_conflict','Request key belongs to different command arguments.');if(prior.state!=='deferred')return {...prior,replayed:true};}catch(e){if(e.code!=='execution_not_found')throw e;}
  const admission=await this.resources.check();if(!admission.allowed){
   const reason=/^[a-z_]{1,64}$/.test(admission.reason??'')?admission.reason:'resource_pressure';
   await atomic(p.receipt,{id,intent,state:'deferred',reason,startedAt:null,exitCode:null,signal:null,bytes:0,no_operation_started:true,retryAfterSeconds:admission.retryAfterSeconds??2,untrusted:true});
   throw fail('resource_pressure','Command deferred without execution. Retry the same requestKey and identical arguments after capacity recovers; no background command was scheduled.');
  }
  if(this.expired||this.stopping)throw fail('workspace_expired','Runtime stopped before command admission.');
  // Reserve synchronously before the first filesystem await so concurrent identical starts cannot spawn twice.
  if(this.active.has(id))throw fail('execution_busy','The same execution is being admitted; inspect its receipt.');
  const slot={child:null,reason:null,timer:null};this.active.set(id,slot);
  try{
   const receipt={id,intent,state:'starting',startedAt:this.now(),exitCode:null,signal:null,bytes:0,untrusted:true};await atomic(p.receipt,receipt);
   const log=await open(p.log,'wx',0o600);
   if(this.stopping||this.expired){await log.close();await atomic(p.receipt,{...receipt,state:'failed',reason:'runtime_stopped',finishedAt:this.now()});throw fail('workspace_expired','Runtime stopped before command spawn.');}
   // Explicit environment: no inherited host/provider/control secrets or process credentials.
   const env={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:join(this.root,'home'),TMPDIR:'/tmp',LANG:'C.UTF-8',CI:'1',TERM:'dumb',PLAYWRIGHT_BROWSERS_PATH:'/opt/playwright',DATABASE_URL:'postgresql://workspace@127.0.0.1:5432/postgres'};
   let child;try{child=spawn(argv[0],argv.slice(1),{cwd:directory,uid:this.uid,gid:this.gid,env,detached:true,stdio:['ignore','pipe','pipe']});}catch(e){await log.close();throw e;}
   slot.child=child;let chain=Promise.resolve(),bytes=0,logFailed=false;
   const kill=reason=>{slot.reason??=reason;try{process.kill(-child.pid,'SIGKILL');}catch{/* Already ended. */}child.stdout.destroy();child.stderr.destroy();};
   slot.kill=kill;slot.timer=setTimeout(()=>kill('timeout'),timeoutMs);slot.timer.unref();
   const collect=chunk=>{if(bytes+chunk.length>this.maxLogBytes){kill('log_limit_exceeded');return;}bytes+=chunk.length;chain=chain.then(()=>log.write(chunk)).catch(()=>{logFailed=true;kill('log_storage_failed');});};
   child.stdout.on('data',collect);child.stderr.on('data',collect);
   // Both spawn errors and close settle through this one receipt update.
   let spawnFailed=false,drainTimer;child.once('error',()=>{spawnFailed=true;});child.once('exit',()=>{try{process.kill(-child.pid,'SIGKILL');}catch{/* Original group already ended. */}drainTimer=setTimeout(()=>kill('detached_output_still_open'),1000);drainTimer.unref();});
   slot.done=new Promise(resolveDone=>child.once('close',(code,signal)=>{clearTimeout(slot.timer);clearTimeout(drainTimer);try{process.kill(-child.pid,'SIGKILL');}catch{/* No background descendants. */}
    chain.then(async()=>{await log.sync();await log.close();Object.assign(receipt,{state:spawnFailed?'failed':slot.reason||signal||code!==0?'failed':'completed',exitCode:code,signal:signal??null,reason:spawnFailed?'executable_unavailable':slot.reason??(logFailed?'log_storage_failed':null),finishedAt:this.now(),bytes});await atomic(p.receipt,receipt);}).catch(()=>{receipt.state='uncertain';}).finally(()=>{this.active.delete(id);resolveDone();});
   }));
   receipt.state='running';// Do not overwrite a completed receipt after a very short child exits.
   // The already durable starting receipt is sufficient after a crash; running status is in memory.
   return {...receipt};
  }catch(e){this.active.delete(id);throw e;}
  }finally{this.admitting.delete(id);}
 }
 async status(id){await this.touch();const receipt=await this.inspect(id);return this.active.has(id)?{...receipt,state:'running'}:receipt;}
 async logs(id,{offset=0,length=8192,expectedLogHash}={}){
  await this.touch();const receipt=await this.inspect(id);if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<1||length>32768)throw fail('invalid_window','Log windows require a nonnegative offset and1–32768 bytes.');
  const p=this.paths(id);let raw;try{raw=await readFile(p.log);}catch(e){if(e.code!=='ENOENT')throw e;raw=Buffer.alloc(0);}
  if(raw.length>this.maxLogBytes)throw fail('invalid_log','Log exceeded its configured bound.');
  // Scan the entire retained stream before paging: credentials split across chunks/windows stay masked.
  const safe=Buffer.from(redact(raw.toString('utf8'))),end=Math.min(safe.length,offset+length);
  const logHash=createHash('sha256').update(safe).digest('hex');if(offset>0&&expectedLogHash!==logHash)throw fail('log_changed','Pass the previous logHash for continuation; if output changed, restart at offset zero or wait for completion.');
  return {id,untrusted:true,logHash,base64:safe.subarray(offset,end).toString('base64'),offset,nextOffset:Math.max(offset,end),totalBytes:safe.length,complete:!this.active.has(id)&&receipt.state!=='deferred'&&end>=safe.length,state:this.active.has(id)?'running':receipt.state,redacted:!safe.equals(raw),logLimitBytes:this.maxLogBytes};
 }
 async cancel(id){await this.touch();this.paths(id);if(this.admitting.has(id))throw fail('execution_busy','Admission is in progress; retry cancellation for the same execution.');this.admitting.add(id);try{const receipt=await this.inspect(id),slot=this.active.get(id);if(receipt.state==='deferred'){const cancelled={...receipt,state:'failed',reason:'cancelled_before_start',finishedAt:this.now()};await atomic(this.paths(id).receipt,cancelled);return cancelled;}if(slot){slot.kill('cancelled');await slot.done;return await this.inspect(id);}return {...receipt,replayed:true};}finally{this.admitting.delete(id);}}

 async expire(){if(this.lastActivity+this.idleMs>this.now())return false;this.expired=true;await this.shutdown('idle_timeout');return true;}
 async shutdown(reason='runtime_stopped'){this.stopping=true;this.resources.close();const slots=[...this.active.values()];for(const slot of slots)slot.kill?.(reason);await Promise.all(slots.map(s=>s.done));}
}
