import {it,expect} from 'vitest';
import {generateKeyPairSync,sign} from 'node:crypto';
import {cleanupEvidence} from '../../src/playground/admission.js';
it('requires fresh signed project proof of exactly the bound Compose and all four owned volumes',async()=>{
 const now=Date.now(),{privateKey,publicKey}=generateKeyPairSync('ed25519'),stored={workspace:'job_0123456789abcdef',binding:'a'.repeat(64),providerProject:'fixture',composeId:'owned-compose',plan:{volumes:['owned-files','owned-git','owned-broker','owned-execution']}};
 const base={workspace_id:stored.workspace,binding:stored.binding,observedAt:now,expiresAt:now+60000,cleanup:{composeId:stored.composeId,composeAbsent:true,containersAbsent:true,volumesAbsent:[...stored.plan.volumes]}};
 let observation=base,project='fixture',tamper=false;
 const ctx={now:()=>now,env:{PLAYGROUND_TELEMETRY_URL:'https://operator.example.test/observations',PLAYGROUND_TELEMETRY_PUBLIC_KEY:'ed25519:'+publicKey.export({format:'der',type:'spki'}).toString('base64')},fetch:async()=>{const body=JSON.stringify({purpose:'robinson-playground-capacity/v1',project,observedAt:now,allocations:[observation]});return new Response(tamper?body+' ':body,{headers:{'x-robinson-telemetry-signature':'ed25519:'+sign(null,Buffer.from(body),privateKey).toString('base64url')}});}};
 expect(await cleanupEvidence(ctx,stored)).toBe(true);
 for(const patch of [{binding:'b'.repeat(64)},{workspace_id:'job_1111111111111111'},{observedAt:now-60001},{expiresAt:now},{observedAt:now+1},{cleanup:{...base.cleanup,composeId:'foreign'}},{cleanup:{...base.cleanup,containersAbsent:false}},{cleanup:{...base.cleanup,volumesAbsent:stored.plan.volumes.slice(1)}},{cleanup:{...base.cleanup,volumesAbsent:[...stored.plan.volumes,'foreign']}},{cleanup:{...base.cleanup,volumesAbsent:Array(4).fill('owned-files')}}]){observation={...base,...patch};expect(await cleanupEvidence(ctx,stored)).toBe(false);}
 observation=base;project='foreign';expect(await cleanupEvidence(ctx,stored)).toBe(false);project='fixture';tamper=true;expect(await cleanupEvidence(ctx,stored)).toBe(false);
 expect(await cleanupEvidence({...ctx,env:{PLAYGROUND_ENFORCEMENT:JSON.stringify([base])}},stored)).toBe(false);
});
