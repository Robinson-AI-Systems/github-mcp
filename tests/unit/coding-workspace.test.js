import {it,expect} from 'vitest';
import {generateKeyPairSync,sign} from 'node:crypto';
import {codingCapacity} from '../../workers/coding-workspace/capacity.js';
import {verifyCodingClaim} from '../../workers/coding-workspace/server.js';
const binding='a'.repeat(64);
const keys=generateKeyPairSync('ed25519'),key='ed25519:'+keys.publicKey.export({format:'der',type:'spki'}).toString('base64');
const sig=body=>'ed25519:'+sign(null,Buffer.from(body),keys.privateKey).toString('base64url');
it('enforces purpose, immutable binding, short expiry and no credential-bearing signed claims',()=>{
 const base={purpose:'robinson-coding/v1',binding,expiresAt:Date.now()+60000,action:'capabilities'};
 const accept=x=>{const b=JSON.stringify(x);return verifyCodingClaim(b,sig(b),key,binding);};
 expect(accept(base).action).toBe('capabilities');
 for(const patch of [{purpose:'native-git'},{binding:'b'.repeat(64)},{expiresAt:0},{expiresAt:Date.now()+120000},{credential:'ghp_FAKE_NEVER_ACCEPTED'},{action:'open'}])expect(()=>accept({...base,...patch})).toThrow();
 expect(()=>verifyCodingClaim(JSON.stringify(base),sig('different'),key,binding)).toThrow();
});
it('reports observed cgroup limits separately from shared filesystem availability and unknown quotas',async()=>{
 const c=await codingCapacity({root:'/workspace',read:async p=>p.endsWith('cpu.max')?'800000 100000':p.endsWith('memory.max')?String(8*1024**3):'1234',filesystem:async()=>({bavail:150,bsize:1024**3}),parallelism:()=>32,memory:()=>4567});
 expect(c.cpu).toMatchObject({schedulerParallelism:32,cgroupQuotaCpus:8,dedicatedPhysicalCores:false});expect(c.memory.cgroupLimitBytes).toBe(8*1024**3);expect(c.storage).toMatchObject({filesystemAvailableBytes:150*1024**3,workspaceQuotaBytes:null,quotaVerified:false});
 const missing=await codingCapacity({read:async()=>{throw Error();},filesystem:async()=>{throw Error();},parallelism:()=>{throw Error();},memory:()=>NaN});expect(missing.cpu.cgroupQuotaCpus).toBeNull();expect(missing.memory.availableBytes).toBeNull();expect(missing.storage.filesystemAvailableBytes).toBeNull();
});
