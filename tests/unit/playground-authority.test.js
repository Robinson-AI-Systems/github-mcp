import {it,expect} from 'vitest';
import {generateKeyPairSync,sign} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {watchAuthority} from '../../workers/coding-workspace/authority.js';
import {CodingRuntime} from '../../workers/coding-workspace/runtime.js';
import {verifyRuntimeProof} from '../../src/playground/lifecycle.js';
it('authenticates heartbeat identity, adopts only signed activity and stops on denial or a tampered response',async()=>{
 const runtimeKeys=generateKeyPairSync('ed25519'),controller=generateKeyPairSync('ed25519'),now=Date.now(),binding='a'.repeat(64),publicKey=k=>'ed25519:'+k.export({format:'der',type:'spki'}).toString('base64');
 for(const scenario of ['allowed','revoked','tampered']){
  let finish;const done=new Promise(r=>{finish=r;});const activity=[],lost=[];
  const runtime={binding,now:()=>now,identity:{key:runtimeKeys.privateKey},recordAuthorizedActivity:async at=>{activity.push(at);finish();}};
  const stop=watchAuthority({runtime,key:publicKey(controller.publicKey),url:'https://control.example.test/lifecycle',intervalMs:100000,onLost:async reason=>{lost.push(reason);finish();},fetch:async(url,init)=>{
   expect(url).toBe('https://control.example.test/lifecycle');expect(init.redirect).toBe('error');
   const proof=verifyRuntimeProof(init.body,init.headers['x-robinson-runtime-signature'],{binding,runtimePublicKey:publicKey(runtimeKeys.publicKey)},now);
   const body=JSON.stringify({purpose:'robinson-coding/v1',action:'authority',binding,requestNonce:proof.nonce,allowed:scenario!=='revoked',bootstrap:false,reason:'grant_revoked',activityAt:now-1000,expiresAt:now+60000});
   return new Response(scenario==='tampered'?body+' ':body,{headers:{'x-robinson-signature':'ed25519:'+sign(null,Buffer.from(body),controller.privateKey).toString('base64url')}});
  }});
  try{await done;if(scenario==='allowed'){expect(activity).toEqual([now-1000]);expect(lost).toEqual([]);}else{expect(activity).toEqual([]);expect(lost).toEqual([scenario==='revoked'?'grant_revoked':'authorization_unavailable']);}}finally{stop();}
 }
});
it('persists authorized Git activity without shortening a lease or renewing from a stale heartbeat',async()=>{
 const root=await mkdtemp(join(tmpdir(),'signed-activity-'));await mkdir(join(root,'control'));const now=Date.now(),runtime={root,binding:'a'.repeat(64),now:()=>now,lastActivity:now-2000,leaseWrites:Promise.resolve()};
 try{
  await CodingRuntime.prototype.recordAuthorizedActivity.call(runtime,now-1000);expect(JSON.parse(await readFile(join(root,'control','workspace.json'),'utf8')).lastActivity).toBe(now-1000);
  await CodingRuntime.prototype.recordAuthorizedActivity.call(runtime,now-3000);expect(runtime.lastActivity).toBe(now-1000);
  await expect(CodingRuntime.prototype.recordAuthorizedActivity.call(runtime,now+90001)).rejects.toThrow();runtime.expired=true;await expect(CodingRuntime.prototype.recordAuthorizedActivity.call(runtime,now)).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
});
it('rides out a control-plane outage without extending the lease, then stops after the bounded grace',async()=>{
 const runtimeKeys=generateKeyPairSync('ed25519'),controller=generateKeyPairSync('ed25519'),binding='a'.repeat(64),publicKey=k=>'ed25519:'+k.export({format:'der',type:'spki'}).toString('base64');
 let now=1_000_000,mode='ok',calls=0;const lost=[];
 const runtime={binding,now:()=>now,identity:{key:runtimeKeys.privateKey},recordAuthorizedActivity:async()=>{}};
 const answer=init=>{const proof=verifyRuntimeProof(init.body,init.headers['x-robinson-runtime-signature'],{binding,runtimePublicKey:publicKey(runtimeKeys.publicKey)},now);const body=JSON.stringify({purpose:'robinson-coding/v1',action:'authority',binding,requestNonce:proof.nonce,allowed:mode!=='denied',bootstrap:false,reason:'grant_revoked',activityAt:now-1000,expiresAt:now+60000});return new Response(body,{headers:{'x-robinson-signature':'ed25519:'+sign(null,Buffer.from(body),controller.privateKey).toString('base64url')}});};
 const ticks=[];let release;
 const next=()=>new Promise(r=>{release=r;});
 let waiter=next();
 const stop=watchAuthority({runtime,key:publicKey(controller.publicKey),url:'https://control.example.test/lifecycle',intervalMs:5,retryMs:5,graceMs:120000,onLost:async reason=>{lost.push(reason);},fetch:async(_url,init)=>{calls++;ticks.push(mode);const r=mode==='down'?Promise.reject(new TypeError('fetch failed')):Promise.resolve(answer(init));release();waiter=next();return r;}});
 const tick=async()=>{await waiter;await new Promise(r=>setTimeout(r,2));};
 try{
  await tick();expect(runtime.authorityLease.allowed).toBe(true);const first=runtime.authorityLease.expiresAt;
  mode='down';now+=30000;await tick();expect(lost).toEqual([]);expect(runtime.authorityLease.expiresAt).toBe(first);
  now+=40000;await tick();expect(lost).toEqual([]);expect(runtime.authorityLease.expiresAt).toBeLessThanOrEqual(now);
  now+=200000;await tick();expect(lost).toEqual(['authorization_unavailable']);
 }finally{stop();}
 expect(calls).toBeGreaterThan(3);
});
it('still stops at once on a signed denial even after an outage',async()=>{
 const runtimeKeys=generateKeyPairSync('ed25519'),controller=generateKeyPairSync('ed25519'),binding='b'.repeat(64),publicKey=k=>'ed25519:'+k.export({format:'der',type:'spki'}).toString('base64');
 const now=2_000_000;const lost=[];let n=0,done;const finished=new Promise(r=>{done=r;});
 const runtime={binding,now:()=>now,identity:{key:runtimeKeys.privateKey},recordAuthorizedActivity:async()=>{}};
 const stop=watchAuthority({runtime,key:publicKey(controller.publicKey),url:'https://control.example.test/lifecycle',intervalMs:5,retryMs:5,onLost:async r=>{lost.push(r);done();},fetch:async(_u,init)=>{n++;if(n===2)throw new TypeError('down');const proof=verifyRuntimeProof(init.body,init.headers['x-robinson-runtime-signature'],{binding,runtimePublicKey:publicKey(runtimeKeys.publicKey)},now);const body=JSON.stringify({purpose:'robinson-coding/v1',action:'authority',binding,requestNonce:proof.nonce,allowed:n===1,bootstrap:false,reason:'grant_revoked',activityAt:now-1000,expiresAt:now+60000});return new Response(body,{headers:{'x-robinson-signature':'ed25519:'+sign(null,Buffer.from(body),controller.privateKey).toString('base64url')}});}});
 try{await finished;expect(lost).toEqual(['grant_revoked']);expect(n).toBe(3);}finally{stop();}
});
it('keeps retrying while the broker is still starting instead of exiting (issue #509), then gives up after the startup window', async () => {
 const runtimeKeys=generateKeyPairSync('ed25519'),controller=generateKeyPairSync('ed25519'),binding='c'.repeat(64),publicKey=k=>'ed25519:'+k.export({format:'der',type:'spki'}).toString('base64');
 let now=3_000_000,n=0;const lost=[];let release;let waiter=new Promise(r=>{release=r;});
 const runtime={binding,now:()=>now,identity:{key:runtimeKeys.privateKey},recordAuthorizedActivity:async()=>{}};
 const stop=watchAuthority({runtime,key:publicKey(controller.publicKey),url:'http://broker:3000/v1/authority',intervalMs:5,retryMs:5,startupRetryMs:5,startupMs:60000,onLost:async r=>{lost.push(r);},fetch:async(_u,init)=>{n++;const r=release;waiter=new Promise(x=>{release=x;});r();
  if(n<=3)throw new TypeError('connect ECONNREFUSED');
  const proof=verifyRuntimeProof(init.body,init.headers['x-robinson-runtime-signature'],{binding,runtimePublicKey:publicKey(runtimeKeys.publicKey)},now);
  const body=JSON.stringify({purpose:'robinson-coding/v1',action:'authority',binding,requestNonce:proof.nonce,allowed:false,bootstrap:true,reason:'attachment_pending',expiresAt:now+60000});
  return new Response(body,{headers:{'x-robinson-signature':'ed25519:'+sign(null,Buffer.from(body),controller.privateKey).toString('base64url')}});}});
 try{
  for(let i=0;i<5;i++){await waiter;await new Promise(r=>setTimeout(r,3));now+=1000;}
  expect(lost).toEqual([]);expect(runtime.authorityLease).toMatchObject({bootstrap:true});
 }finally{stop();}
 // Never answered at all: exits once the startup window has passed.
 let m=0;const lost2=[];let t=4_000_000;const r2={binding,now:()=>t,identity:{key:runtimeKeys.privateKey},recordAuthorizedActivity:async()=>{}};
 let done;const finished=new Promise(r=>{done=r;});
 const stop2=watchAuthority({runtime:r2,key:publicKey(controller.publicKey),url:'http://broker:3000/v1/authority',startupRetryMs:2,startupMs:10000,onLost:async r=>{lost2.push(r);done();},fetch:async()=>{m++;t+=4000;throw new TypeError('down');}});
 try{await finished;expect(lost2).toEqual(['authorization_unavailable']);expect(m).toBeGreaterThanOrEqual(3);}finally{stop2();}
});
