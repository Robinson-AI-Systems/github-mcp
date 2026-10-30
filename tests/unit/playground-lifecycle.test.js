import {it,expect} from 'vitest';
import {generateKeyPairSync,sign} from 'node:crypto';
import {allocationAuthority,verifyRuntimeProof} from '../../src/playground/lifecycle.js';
it('requires current grants, repository authorization and fresh enforcement without credential fallback',async()=>{
 const now=Date.now(),binding='a'.repeat(64),job={kind:'native-git-workspace',state:'pending',expires_at:new Date(now+14400000)};
 let rows=[{client_id:'client',profile:'full',accounts:['example-org'],mode:'production'}],providerCalls=0;
 const ctx={now:()=>now,env:{},stored:{binding,workspace:'job_0123456789abcdef',connection:'client',clientId:'client',owner:'example-org',repo:'hello',phase:'attached'},db:{getJob:async()=>job,listUpgradeableConnections:async()=>rows}};
 expect(await allocationAuthority(ctx)).toMatchObject({allowed:false,cleanup:false,reason:'enforcement_unverified'});
 rows=[];expect(await allocationAuthority(ctx)).toMatchObject({allowed:false,cleanup:true,reason:'grant_expired_or_revoked'});
 rows=[{client_id:'client',profile:'read_only',accounts:['example-org']}];expect(await allocationAuthority(ctx)).toMatchObject({allowed:false,cleanup:true,reason:'grant_restricted'});
 expect(await allocationAuthority({...ctx,membershipValid:false})).toMatchObject({cleanup:true,reason:'membership_revoked'});
 expect(await allocationAuthority({...ctx,namespaceMissing:true})).toMatchObject({cleanup:true,reason:'namespace_removed'});
 expect(providerCalls).toBe(0);
});
it('accepts only the exact bound fresh runtime identity proof',()=>{
 const now=Date.now(),{privateKey,publicKey}=generateKeyPairSync('ed25519'),stored={binding:'a'.repeat(64),runtimePublicKey:'ed25519:'+publicKey.export({format:'der',type:'spki'}).toString('base64')};
 const p={purpose:'robinson-playground-heartbeat/v1',binding:stored.binding,nonce:'b'.repeat(32),expiresAt:now+30000},body=JSON.stringify(p),signature='ed25519:'+sign(null,Buffer.from(body),privateKey).toString('base64url');
 expect(verifyRuntimeProof(body,signature,stored,now)).toEqual(p);
 expect(()=>verifyRuntimeProof(body+' ',signature,stored,now)).toThrow();expect(()=>verifyRuntimeProof(body,signature,{...stored,binding:'c'.repeat(64)},now)).toThrow();expect(()=>verifyRuntimeProof(body,signature,stored,now+30000)).toThrow();
});
