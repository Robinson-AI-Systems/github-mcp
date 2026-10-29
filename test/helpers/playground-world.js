// Real signed HTTP transport. Only the command engine is faked in unit contracts;
// the dedicated image substitutes the real UID-separated command engine.
import {mkdtemp,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {prepareNativeWorld} from './native-git-world.js';
import {nativeRecord} from '../../src/native-git/client.js';
import {nativeWorkerPublicKey} from '../../src/native-git/signing.js';
import {playgroundBinding,playgroundExecutionId} from '../../src/playground/client.js';
import {codingServer} from '../../workers/coding-workspace/server.js';
import {CodingRuntime} from '../../workers/coding-workspace/runtime.js';
export async function preparePlaygroundWorld(w,{real=false}={}){
 const closeNative=await prepareNativeWorld(w,{existing:true});
 const record=await nativeRecord(w.ctx,'job_0123456789abcdef'),binding=playgroundBinding(record);
 const root=await mkdtemp(join(tmpdir(),'playground-contract-'));await chmod(root,0o755);
 const receipts=new Map();let starts=0,cancels=0;
 const runtime=real?await new CodingRuntime({root,binding,now:w.ctx.now}).init():{
  binding,root,idleMs:4*3600000,lastActivity:w.ctx.now(),
  async start(o){this.lastActivity=w.ctx.now();const id=playgroundExecutionId(binding,o.requestKey),intent=createHash('sha256').update(JSON.stringify(o)).digest('hex');if(receipts.has(id)){if(receipts.get(id).intent!==intent)throw Object.assign(new TypeError('conflict'),{code:'intent_conflict'});return {...receipts.get(id),replayed:true};}starts++;const r={id,intent,state:'running',exitCode:null,signal:null};receipts.set(id,r);return r;},
  async status(id){this.lastActivity=w.ctx.now();const r=receipts.get(id)??{id,state:'running',exitCode:null,signal:null};return w.gh.nativeOutcome==='mismatch'?{...r,id:'b'.repeat(64)}:r;},
  async logs(id){this.lastActivity=w.ctx.now();return{id,base64:Buffer.from('complete fixture output\n').toString('base64'),complete:true,logHash:'a'.repeat(64),nextOffset:24};},
  async cancel(id){this.lastActivity=w.ctx.now();cancels++;const r={id,state:'failed',exitCode:null,signal:'SIGKILL',reason:'cancelled'};receipts.set(id,r);return r;},async expire(){return false;},async shutdown(){}
 };
 const server=codingServer({runtime,key:nativeWorkerPublicKey(w.ctx.env),now:w.ctx.now});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const prior=w.ctx.fetch;w.playgroundRequests=[];const fetchRuntime=(url,init)=>{if(!String(url).startsWith('https://playground.example.test/'))return prior(url,init);w.playgroundRequests.push(JSON.parse(init.body));return fetch(origin+'/v1/coding',init);};
 w.gh.fetch=fetchRuntime;w.ctx={...w.ctx,fetch:fetchRuntime,env:{...w.ctx.env,PLAYGROUND_ALLOCATIONS:JSON.stringify([{workspace_id:record.row.id,binding,origin:'https://playground.example.test/'}])}};
 w.playground={runtime,root,binding,starts:()=>starts,cancels:()=>cancels};
 return async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await runtime.shutdown();await closeNative();await rm(root,{recursive:true,force:true});};
}
