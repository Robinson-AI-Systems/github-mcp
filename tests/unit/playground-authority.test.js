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
