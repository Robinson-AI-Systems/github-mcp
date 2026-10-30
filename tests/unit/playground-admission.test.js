import {it,expect} from 'vitest';
import {generateKeyPairSync,sign} from 'node:crypto';
import {allocationAdmission,refreshAdmission} from '../../src/playground/admission.js';
it('uses fresh signed project telemetry and never reuses static capacity when its feed fails',async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ed25519'),now=Date.now(),config={project:'fixture'};
 let snapshot={purpose:'robinson-playground-capacity/v1',project:'fixture',observedAt:now,availableMemoryBytes:1024**3,availableDiskBytes:2*1024**3,pressure:0};
 let fail=false,tamper=false;
 const ctx={env:{PLAYGROUND_TELEMETRY_URL:'https://telemetry.example.test/capacity',PLAYGROUND_TELEMETRY_PUBLIC_KEY:'ed25519:'+publicKey.export({format:'der',type:'spki'}).toString('base64'),PLAYGROUND_ADMISSION:JSON.stringify(snapshot)},fetch:async(url,init)=>{expect(url).toBe('https://telemetry.example.test/capacity');expect(init.redirect).toBe('error');if(fail)throw Error('offline');const body=JSON.stringify(snapshot);return new Response(tamper?body+' ':body,{headers:{'x-robinson-telemetry-signature':'ed25519:'+sign(null,Buffer.from(body),privateKey).toString('base64url')}});}};
 const sample=async()=>allocationAdmission((await refreshAdmission(ctx,config)).env,config,now);
 expect((await sample()).allowed).toBe(true);
 snapshot={...snapshot,availableMemoryBytes:1};expect((await sample()).reason).toBe('memory_pressure');
 snapshot={...snapshot,availableMemoryBytes:1024**3,observedAt:now-60001};expect((await sample()).reason).toBe('capacity_unverified');
 snapshot={...snapshot,observedAt:now,project:'foreign'};expect((await sample()).allowed).toBe(false);
 snapshot={...snapshot,project:'fixture'};tamper=true;expect((await sample()).allowed).toBe(false);
 tamper=false;fail=true;expect((await sample()).allowed).toBe(false);
});
